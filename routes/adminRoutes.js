import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();


// Before we can assign anyone, we need a way to add agents (workers/technicians) to your database.
// POST /admin/agents - Create a new Agent
// POST /admin/agents - Create a new Agent
router.post('/agents', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const { name, email, phone, city_id, category_id } = req.body;

        if (!name || !email || !phone || !city_id || !category_id) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        // 1. Insert into users table (Required so they can actually log into the app)
        await db.prepare(`
            INSERT INTO users (name, user_name, email, phone, role) 
            VALUES (?, ?, ?, ?, 'agent')
        `).bind(name, name, email, phone).run();

        // 2. Insert into your specific agents table schema
        await db.prepare(`
            INSERT INTO agents (name, phone, email, category_id, city_id, status) 
            VALUES (?, ?, ?, ?, ?, 'available')
        `).bind(name, phone, email, category_id, city_id).run();

        res.status(201).json({ success: true, message: "Agent created successfully" });

    } catch (err) {
        console.error(err);
        // Handle unique constraint error gracefully (e.g., if email already exists in either table)
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ success: false, message: "Email or phone already exists." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /admin/agents - List all agents
router.get('/agents', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;

        // Updated Query: We don't need to JOIN the users table anymore 
        // because name, email, and phone are directly in your agents table!
        const query = `
            SELECT 
                a.id as agent_id, a.name, a.email, a.phone, 
                a.status, c.name as city_name, cat.name as category_name
            FROM agents a
            JOIN cities c ON a.city_id = c.id
            JOIN categories cat ON a.category_id = cat.id
            ORDER BY a.created_at DESC
        `;

        const { results } = await db.prepare(query).all();
        res.status(200).json({ success: true, agents: results });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// This endpoint grabs all ordered_items that haven't been assigned an agent yet. We JOIN the orders table to get the customer's address and city, and the services table to know what category of worker is needed.
router.get('/tasks/unassigned', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        // Optional query parameters to let the admin filter by city or category
        const { city_id, category_id } = req.query;

        let query = `
            SELECT 
                oi.id as task_id, 
                s.name as service_name, 
                s.category_id,
                o.service_address, 
                c.name as city_name, 
                o.city_id,
                u.user_name as customer_name,
                u.phone as customer_phone,
                oi.created_at
            FROM ordered_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN services s ON oi.service_id = s.id
            JOIN cities c ON o.city_id = c.id
            JOIN users u ON oi.user_id = u.id
            WHERE oi.status = 'pending' AND oi.agent_id IS NULL
        `;

        const params = [];

        // Dynamically build the query if filters are applied
        if (city_id) {
            query += ` AND o.city_id = ?`;
            params.push(city_id);
        }
        if (category_id) {
            query += ` AND s.category_id = ?`;
            params.push(category_id);
        }

        query += ` ORDER BY oi.created_at ASC`; // Oldest tasks first

        // Use D1's bind with spread operator for dynamic arrays
        const { results } = await db.prepare(query).bind(...params).all();

        res.status(200).json({ success: true, tasks: results });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// When the admin clicks on a pending "Plumbing" task in "Dehradun", they need a list of available plumbers in Dehradun to assign it to.
router.get('/agents/available', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const { city_id, category_id } = req.query;

        if (!city_id || !category_id) {
            return res.status(400).json({ success: false, message: "city_id and category_id are required" });
        }

        const query = `
            SELECT id, name, phone, status 
            FROM agents 
            WHERE city_id = ? AND category_id = ? AND status = 'available'
        `;

        const { results } = await db.prepare(query).bind(city_id, category_id).all();

        res.status(200).json({ success: true, agents: results });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// This finalizes the dispatch. It updates the specific task (ordered_items) with the agent_id and changes the status to assigned.
router.patch('/tasks/:taskId/assign', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const taskId = req.params.taskId;
        const { agent_id } = req.body;

        if (!agent_id) {
            return res.status(400).json({ success: false, message: "agent_id is required" });
        }

        // 1. Optional Safety Check: Ensure the agent exists and isn't inactive
        const agent = await db.prepare('SELECT status FROM agents WHERE id = ?').bind(agent_id).first();
        if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });
        if (agent.status === 'inactive') return res.status(400).json({ success: false, message: "Cannot assign to an inactive agent" });

        // 2. Assign the agent and update the task status
        const updateQuery = `
            UPDATE ordered_items 
            SET agent_id = ?, status = 'assigned' 
            WHERE id = ? AND status = 'pending'
        `;

        const result = await db.prepare(updateQuery).bind(agent_id, taskId).run();

        // 3. Check if the task was actually updated (prevents double-assigning a job)
        if (result.meta.changes === 0) {
            return res.status(400).json({
                success: false,
                message: "Task not found, or it has already been assigned/completed."
            });
        }

        res.status(200).json({ success: true, message: "Agent successfully assigned to task." });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// GET /admin/tasks/all — Fetch ALL tasks with full details (all statuses)
// Supports optional query params: ?status=assigned&city_id=1&category_id=2
router.get('/tasks/all', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const { status, city_id, category_id } = req.query;

        let query = `
            SELECT 
                oi.id as task_id, 
                oi.status,
                oi.price_at_booking,
                oi.created_at,
                s.name as service_name, 
                s.category_id,
                o.service_address, 
                c.name as city_name, 
                o.city_id,
                u.user_name as customer_name,
                u.email as customer_email,
                u.phone as customer_phone,
                a.name as agent_name,
                a.phone as agent_phone
            FROM ordered_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN services s ON oi.service_id = s.id
            JOIN cities c ON o.city_id = c.id
            JOIN users u ON oi.user_id = u.id
            LEFT JOIN agents a ON oi.agent_id = a.id
            WHERE 1=1
        `;

        const params = [];

        if (status) {
            query += ` AND oi.status = ?`;
            params.push(status);
        }
        if (city_id) {
            query += ` AND o.city_id = ?`;
            params.push(city_id);
        }
        if (category_id) {
            query += ` AND s.category_id = ?`;
            params.push(category_id);
        }

        query += ` ORDER BY oi.created_at DESC`;

        const { results } = await db.prepare(query).bind(...params).all();

        res.status(200).json({ success: true, tasks: results });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;