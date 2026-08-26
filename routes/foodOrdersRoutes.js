import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyRestaurantOwner } from "../middleware/auth";

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
            SELECT fc.quantity, rm.id as menu_item_id, rm.price, rm.restaurant_id 
            FROM food_carts fc
            JOIN restaurant_menus rm ON fc.menu_item_id = rm.id
            WHERE fc.user_id = ?
        `;
        const { results: cartItems } = await db.prepare(cartQuery).bind(userId).all();

        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        const restaurantId = cartItems[0].restaurant_id;
        const foodTotal = cartItems.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
        const deliveryFee = 40;
        const totalAmount = foodTotal + deliveryFee;

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
                    INSERT INTO food_ordered_items (order_id, menu_item_id, price, quantity) 
                    VALUES (?, ?, ?, ?)
                `).bind(orderId, item.menu_item_id, item.price, item.quantity)
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
            message: "Order created. Complete payment to confirm it.",
            order_id: orderId,
            total_amount: totalAmount
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
                            'quantity', i.quantity
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

// Restaurant users can only manage orders for their assigned restaurant.
router.get('/restaurant/my-orders', verifyToken, verifyRestaurantOwner, async (req, res) => {
    try {
        const db = await env.DB;
        const query = `
            SELECT o.id AS order_id, o.total_amount, o.status, o.payment_status, o.delivery_address, o.created_at,
                   COALESCE(u.name, u.user_name) AS customer_name, u.phone AS customer_phone,
                   (
                     SELECT json_group_array(json_object('item_id', i.id, 'menu_item_name', rm.name, 'price', i.price, 'quantity', i.quantity))
                     FROM food_ordered_items i JOIN restaurant_menus rm ON rm.id = i.menu_item_id
                     WHERE i.order_id = o.id
                   ) AS items
            FROM food_orders o
            JOIN restaurants r ON r.id = o.restaurant_id
            JOIN users u ON u.id = o.user_id
            WHERE r.owner_id = ? AND o.payment_status = 'paid'
            ORDER BY o.created_at DESC
        `;
        const { results } = await db.prepare(query).bind(req.dbUser.id).all();
        res.status(200).json({ success: true, orders: results.map((order) => ({ ...order, items: JSON.parse(order.items || '[]') })) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.patch('/:orderId/status', verifyToken, verifyRestaurantOwner, async (req, res) => {
    try {
        const db = await env.DB;
        const orderId = Number(req.params.orderId);
        const { status } = req.body;
        if (!Number.isInteger(orderId) || !['out_for_delivery', 'delivered'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status must be out_for_delivery or delivered' });
        }

        const order = await db.prepare(`
            SELECT o.id, o.status FROM food_orders o
            JOIN restaurants r ON r.id = o.restaurant_id
            WHERE o.id = ? AND r.owner_id = ? AND o.payment_status = 'paid'
        `).bind(orderId, req.dbUser.id).first();
        if (!order) return res.status(404).json({ success: false, message: 'Paid order not found for your restaurant' });
        if (order.status === 'delivered') return res.status(400).json({ success: false, message: 'Completed orders cannot be changed' });

        await db.prepare('UPDATE food_orders SET status = ? WHERE id = ?').bind(status, orderId).run();
        res.status(200).json({ success: true, message: 'Order status updated', status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
