import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken } from "../middleware/auth";

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

router.get('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;

        const query = `
            SELECT 
                o.id as order_id,
                o.total_amount,
                o.status,
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
