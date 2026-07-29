import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAgent, verifyAdmin } from "../middleware/auth";

const router = express.Router();

// This fetches all tasks currently assigned to the logged-in agent. It joins the orders and users tables so the agent knows exactly what to do, who the customer is, and where to go.
router.get('/tasks', verifyToken, verifyAgent, async (req, res) => {
    try {
        const db = await env.DB;
        const agentId = req.agent.id; // From your auth middleware

        const query = `
            SELECT 
                oi.id as task_id, 
                s.name as service_name,
                o.service_address,
                u.user_name as customer_name,
                u.email as customer_email,
                oi.price_at_booking,
                oi.created_at as assigned_date
            FROM ordered_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN services s ON oi.service_id = s.id
            JOIN users u ON oi.user_id = u.id
            WHERE oi.agent_id = ? AND oi.status = 'assigned'
            ORDER BY oi.created_at ASC
        `;

        const { results } = await db.prepare(query).bind(agentId).all();

        res.status(200).json({ success: true, tasks: results });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// Once the agent finishes the job, they hit this endpoint. We include agentId in the WHERE clause as a security measure so an agent can only complete their own assigned tasks.
router.patch('/tasks/:taskId/complete', verifyToken, verifyAgent, async (req, res) => {
    try {
        const db = await env.DB;
        const agentId = req.agent.id;
        const taskId = req.params.taskId;

        const updateQuery = `
            UPDATE ordered_items 
            SET status = 'completed' 
            WHERE id = ? AND agent_id = ? AND status = 'assigned'
        `;

        const result = await db.prepare(updateQuery).bind(taskId, agentId).run();

        // If no rows were changed, either the task doesn't exist, it's not assigned to this agent, or it's already completed.
        if (result.meta.changes === 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid task, or task is not assigned to you."
            });
        }

        res.status(200).json({ success: true, message: "Job marked as completed successfully." });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// Agents need a way to go "off-duty" (e.g., they are done for the day or are taking a lunch break) so the admin dispatcher doesn't assign them jobs they can't fulfill.
router.patch('/status', verifyToken, verifyAgent, async (req, res) => {
    try {
        const db = await env.DB;
        const agentId = req.agent.id;
        const { status } = req.body;

        // Validate the status input
        const validStatuses = ['available', 'busy', 'inactive'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status. Must be 'available', 'busy', or 'inactive'."
            });
        }

        await db.prepare('UPDATE agents SET status = ? WHERE id = ?')
            .bind(status, agentId).run();

        res.status(200).json({ success: true, message: `Status updated to ${status}` });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;