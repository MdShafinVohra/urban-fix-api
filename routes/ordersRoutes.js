import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();

router.post('/checkout-cart', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { service_address, city_id } = req.body;

        // 1. Validate inputs
        if (!service_address || !city_id) {
            return res.status(400).json({ success: false, message: "service_address and city_id are required" });
        }

        // 2. Fetch the user's cart along with current prices
        const cartQuery = `
            SELECT c.quantity, s.id as service_id, s.price 
            FROM carts c
            JOIN services s ON c.service_id = s.id
            WHERE c.user_id = ?
        `;
        const { results: cartItems } = await db.prepare(cartQuery).bind(userId).all();

        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        // 3. Calculate total amount
        const totalAmount = cartItems.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);

        // 4. Create the main Order record to get the order_id
        const orderResult = await db.prepare(`
            INSERT INTO orders (user_id, total_amount, service_address, city_id) 
            VALUES (?, ?, ?, ?) RETURNING id
        `).bind(userId, totalAmount, service_address, city_id).first();

        const orderId = orderResult.id;

        // 5. Prepare batch statements for Ordered Items and Clearing the Cart
        const statements = [];

        for (const item of cartItems) {
            // If quantity is 2, create 2 separate task rows so they can be assigned independently
            for (let i = 0; i < item.quantity; i++) {
                statements.push(
                    db.prepare(`
                        INSERT INTO ordered_items (order_id, user_id, service_id, price_at_booking) 
                        VALUES (?, ?, ?, ?)
                    `).bind(orderId, userId, item.service_id, item.price)
                );
            }
        }

        // Add the statement to empty the user's cart
        statements.push(db.prepare('DELETE FROM carts WHERE user_id = ?').bind(userId));

        // 6. Execute the batch transaction
        try {
            await db.batch(statements);
        } catch (batchErr) {
            // Manual rollback: If task creation fails, delete the orphaned order
            await db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run();
            throw new Error(`Failed to create order tasks: ${batchErr.message}`);
        }

        res.status(201).json({
            success: true,
            message: "Order placed successfully",
            order_id: orderId,
            total_amount: totalAmount
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// Users will want to see their order history and track the status of their upcoming services. This endpoint pulls the main order details and nests the specific tasks inside it using SQLite's JSON functions.
router.get('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;

        // Fetch orders and group their related tasks (ordered_items) into a JSON array
        const query = `
            SELECT 
                o.id as order_id,
                o.total_amount,
                o.payment_status,
                o.service_address,
                o.created_at,
                c.name as city_name,
                (
                    SELECT json_group_array(
                        json_object(
                            'task_id', oi.id,
                            'service_name', s.name,
                            'price', oi.price_at_booking,
                            'status', oi.status,
                            'agent_id', oi.agent_id
                        )
                    )
                    FROM ordered_items oi
                    JOIN services s ON oi.service_id = s.id
                    WHERE oi.order_id = o.id
                ) as tasks
            FROM orders o
            JOIN cities c ON o.city_id = c.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `;

        const { results } = await db.prepare(query).bind(userId).all();

        // Parse the stringified JSON array of tasks back into JavaScript objects
        const formattedOrders = results.map(order => ({
            ...order,
            tasks: JSON.parse(order.tasks)
        }));

        res.status(200).json({ success: true, orders: formattedOrders });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


router.patch('/tasks/:taskId/cancel', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const taskId = req.params.taskId;

        // 1. Fetch the task to check its current status
        const task = await db.prepare(`
            SELECT status, order_id, price_at_booking 
            FROM ordered_items 
            WHERE id = ? AND user_id = ?
        `).bind(taskId, userId).first();

        // Ensure the task exists and belongs to the logged-in user
        if (!task) {
            return res.status(404).json({ success: false, message: "Task not found" });
        }

        // Prevent cancelling if the job is already done or already cancelled
        if (task.status === 'completed') {
            return res.status(400).json({ success: false, message: "Cannot cancel a service that is already completed." });
        }
        if (task.status === 'cancelled') {
            return res.status(400).json({ success: false, message: "This service has already been cancelled." });
        }

        // 2. Update the status to 'cancelled'
        // If an agent was already assigned, we also set agent_id to NULL to free it from their queue
        const updateQuery = `
            UPDATE ordered_items 
            SET status = 'cancelled', agent_id = NULL 
            WHERE id = ?
        `;

        await db.prepare(updateQuery).bind(taskId).run();

        // Note: If you process payments BEFORE the service happens, you would 
        // normally trigger your Refund logic here using `task.price_at_booking`.

        res.status(200).json({
            success: true,
            message: "Service cancelled successfully."
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /orders/checkout-direct
router.post('/checkout-direct', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { service_id, quantity = 1, service_address, city_id } = req.body;

        // 1. Validate inputs
        if (!service_id || !service_address || !city_id) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }
        if (quantity < 1) {
            return res.status(400).json({ success: false, message: "Quantity must be at least 1" });
        }

        // 2. Fetch the service to get the current price
        const service = await db.prepare('SELECT id, price FROM services WHERE id = ?').bind(service_id).first();
        if (!service) {
            return res.status(404).json({ success: false, message: "Service not found" });
        }

        // 3. Calculate total amount
        const priceAtBooking = Number(service.price);
        const totalAmount = priceAtBooking * quantity;

        // 4. Create the main Order record
        const orderResult = await db.prepare(`
            INSERT INTO orders (user_id, total_amount, service_address, city_id) 
            VALUES (?, ?, ?, ?) RETURNING id
        `).bind(userId, totalAmount, service_address, city_id).first();

        const orderId = orderResult.id;

        // 5. Prepare batch statements for Ordered Items (creating individual tasks)
        const statements = [];
        for (let i = 0; i < quantity; i++) {
            statements.push(
                db.prepare(`
                    INSERT INTO ordered_items (order_id, user_id, service_id, price_at_booking) 
                    VALUES (?, ?, ?, ?)
                `).bind(orderId, userId, service_id, priceAtBooking)
            );
        }

        // 6. Execute the batch transaction
        try {
            await db.batch(statements);
        } catch (batchErr) {
            await db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run();
            throw new Error(`Failed to create direct order tasks: ${batchErr.message}`);
        }

        res.status(201).json({
            success: true,
            message: "Direct order placed successfully",
            order_id: orderId,
            total_amount: totalAmount
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;