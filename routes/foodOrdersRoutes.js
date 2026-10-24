import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin, verifyRestaurantOwner } from "../middleware/auth";

const router = express.Router();

router.post('/checkout', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { delivery_address } = req.body;

        if (!delivery_address) {
            return res.status(400).json({ success: false, message: "delivery_address is required" });
        }

        // Fetch cart items
        const cartQuery = `
            SELECT fc.quantity, fc.size, COALESCE(fc.unit_price, rm.price) AS price, rm.id as menu_item_id, rm.restaurant_id
            FROM food_carts fc
            JOIN restaurant_menus rm ON fc.menu_item_id = rm.id
            WHERE fc.user_id = ?
        `;
        const { results: cartItems } = await db.prepare(cartQuery).bind(userId).all();

        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        const restaurantId = cartItems[0].restaurant_id;
        const totalAmount = cartItems.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);

        // Create Order
        const orderResult = await db.prepare(`
            INSERT INTO food_orders (user_id, restaurant_id, total_amount, delivery_address) 
            VALUES (?, ?, ?, ?) RETURNING id
        `).bind(userId, restaurantId, totalAmount, delivery_address).first();

        const orderId = orderResult.id;

        // Insert Order Items and Clear Cart
        const statements = [];

        for (const item of cartItems) {
            statements.push(
                db.prepare(`
                    INSERT INTO food_ordered_items (order_id, menu_item_id, price, quantity, size)
                    VALUES (?, ?, ?, ?, ?)
                `).bind(orderId, item.menu_item_id, item.price, item.quantity, item.size)
            );
        }

        statements.push(db.prepare('DELETE FROM food_carts WHERE user_id = ?').bind(userId));

        try {
            await db.batch(statements);
        } catch (batchErr) {
            await db.prepare('DELETE FROM food_orders WHERE id = ?').bind(orderId).run();
            throw new Error(`Failed to create order items: ${batchErr.message}`);
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

router.get('/admin/all', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const { status, payment_status, restaurant_id } = req.query;

        const conditions = [];
        const bindings = [];

        if (status) {
            conditions.push('o.status = ?');
            bindings.push(status);
        }
        if (payment_status) {
            conditions.push('o.payment_status = ?');
            bindings.push(payment_status);
        }
        if (restaurant_id) {
            conditions.push('o.restaurant_id = ?');
            bindings.push(restaurant_id);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const query = `
            SELECT 
                o.id as order_id,
                o.id,
                o.user_id,
                o.restaurant_id,
                o.total_amount,
                o.delivery_address,
                o.status,
                o.payment_status,
                o.created_at,
                r.name as restaurant_name,
                COALESCE(u.name, u.user_name) as customer_name,
                u.email as customer_email,
                u.phone as customer_phone,
                (
                    SELECT json_group_array(
                        json_object(
                            'item_id', i.id,
                            'menu_item_name', rm.name,
                            'price', i.price,
                            'quantity', i.quantity,
                            'size', i.size
                        )
                    )
                    FROM food_ordered_items i
                    JOIN restaurant_menus rm ON i.menu_item_id = rm.id
                    WHERE i.order_id = o.id
                ) as items
            FROM food_orders o
            JOIN users u ON o.user_id = u.id
            JOIN restaurants r ON o.restaurant_id = r.id
            ${whereClause}
            ORDER BY o.created_at DESC
        `;

        const stmt = db.prepare(query);
        const { results } = bindings.length > 0 
            ? await stmt.bind(...bindings).all() 
            : await stmt.all();

        const formattedOrders = (results || []).map(order => {
            let items = [];
            try {
                items = order.items ? JSON.parse(order.items) : [];
            } catch (e) {
                items = [];
            }
            return {
                ...order,
                items
            };
        });

        res.status(200).json({ success: true, orders: formattedOrders });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/restaurant/my-orders', verifyToken, verifyRestaurantOwner, async (req, res) => {
    try {
        const db = await env.DB;
        const ownerId = req.dbUser.id;

        // First find the restaurant where owner_id = req.dbUser.id
        const restaurant = await db.prepare(
            'SELECT id, name FROM restaurants WHERE owner_id = ?'
        ).bind(ownerId).first();

        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }

        const { status, payment_status } = req.query;
        const conditions = ['o.restaurant_id = ?'];
        const bindings = [restaurant.id];

        if (status) {
            conditions.push('o.status = ?');
            bindings.push(status);
        }
        if (payment_status) {
            conditions.push('o.payment_status = ?');
            bindings.push(payment_status);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;

        const query = `
            SELECT 
                o.id as order_id,
                o.id,
                o.user_id,
                o.restaurant_id,
                o.total_amount,
                o.delivery_address,
                o.status,
                o.payment_status,
                o.created_at,
                r.name as restaurant_name,
                COALESCE(u.name, u.user_name) as customer_name,
                u.email as customer_email,
                u.phone as customer_phone,
                (
                    SELECT json_group_array(
                        json_object(
                            'item_id', i.id,
                            'menu_item_name', rm.name,
                            'price', i.price,
                            'quantity', i.quantity,
                            'size', i.size
                        )
                    )
                    FROM food_ordered_items i
                    JOIN restaurant_menus rm ON i.menu_item_id = rm.id
                    WHERE i.order_id = o.id
                ) as items
            FROM food_orders o
            JOIN users u ON o.user_id = u.id
            JOIN restaurants r ON o.restaurant_id = r.id
            ${whereClause}
            ORDER BY o.created_at DESC
        `;

        const { results } = await db.prepare(query).bind(...bindings).all();

        const formattedOrders = (results || []).map(order => {
            let items = [];
            try {
                items = order.items ? JSON.parse(order.items) : [];
            } catch (e) {
                items = [];
            }
            return {
                ...order,
                items
            };
        });

        res.status(200).json({
            success: true,
            orders: formattedOrders,
            restaurant_name: restaurant.name
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.patch('/:id/status', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const orderId = req.params.id;
        const { status } = req.body;

        const validStatuses = ['pending', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Status must be one of: ${validStatuses.join(', ')}`
            });
        }

        // First fetch the order to get restaurant_id
        const order = await db.prepare(`
            SELECT o.id, o.restaurant_id, r.owner_id
            FROM food_orders o
            LEFT JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.id = ?
        `).bind(orderId).first();

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Authorization check: req.dbUser.role === 'ADMIN' OR (role is 'RESTAURANT' AND the restaurant's owner_id === req.dbUser.id)
        const isAuthorized = req.dbUser?.role === 'ADMIN' ||
            (req.dbUser?.role === 'RESTAURANT' && order.owner_id === req.dbUser?.id);

        if (!isAuthorized) {
            return res.status(403).json({ success: false, message: 'Unauthorized to update order status' });
        }

        await db.prepare('UPDATE food_orders SET status = ? WHERE id = ?').bind(status, order.id).run();

        res.status(200).json({
            success: true,
            message: 'Order status updated',
            order_id: order.id,
            status
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.patch('/:id/mark-paid', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const orderId = req.params.id;

        // First fetch the order
        const order = await db.prepare(`
            SELECT o.id, o.user_id, o.total_amount, o.payment_status, o.restaurant_id, r.owner_id
            FROM food_orders o
            LEFT JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.id = ?
        `).bind(orderId).first();

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Authorization check: same as status update
        const isAuthorized = req.dbUser?.role === 'ADMIN' ||
            (req.dbUser?.role === 'RESTAURANT' && order.owner_id === req.dbUser?.id);

        if (!isAuthorized) {
            return res.status(403).json({ success: false, message: 'Unauthorized to mark order as paid' });
        }

        // If order is already paid, return 400
        if (order.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Order is already marked as paid' });
        }

        const transactionId = 'MANUAL-' + Date.now();

        await db.batch([
            db.prepare('UPDATE food_orders SET payment_status = ? WHERE id = ?').bind('paid', order.id),
            db.prepare(`
                INSERT INTO food_payment_details (food_order_id, user_id, transaction_id, amount, payment_method, status)
                VALUES (?, ?, ?, ?, 'manual', 'success')
            `).bind(order.id, order.user_id, transactionId, order.total_amount)
        ]);

        res.status(200).json({
            success: true,
            message: 'Order marked as paid',
            order_id: order.id
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;

        const query = `
            SELECT 
                o.id as order_id,
                o.total_amount,
                o.status,
                o.payment_status,
                o.delivery_address,
                o.created_at,
                r.name as restaurant_name,
                r.image_url as restaurant_image,
                (
                    SELECT json_group_array(
                        json_object(
                            'item_id', i.id,
                            'menu_item_name', rm.name,
                            'price', i.price,
                            'quantity', i.quantity, 'size', i.size
                        )
                    )
                    FROM food_ordered_items i
                    JOIN restaurant_menus rm ON i.menu_item_id = rm.id
                    WHERE i.order_id = o.id
                ) as items
            FROM food_orders o
            JOIN restaurants r ON o.restaurant_id = r.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `;

        const { results } = await db.prepare(query).bind(userId).all();

        const formattedOrders = results.map(order => ({
            ...order,
            items: JSON.parse(order.items)
        }));

        res.status(200).json({ success: true, orders: formattedOrders });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
