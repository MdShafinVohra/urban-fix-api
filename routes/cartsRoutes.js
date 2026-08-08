import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();

// This endpoint fetches all items in the user's cart and joins the services table to get the names and prices so your frontend can display them properly.
router.get('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id; // From your auth middleware

        const query = `
            SELECT 
                c.id as cart_item_id, 
                c.quantity, 
                s.id as service_id, 
                s.name as service_name, 
                s.price, 
                (c.quantity * s.price) as total_price
            FROM carts c
            JOIN services s ON c.service_id = s.id
            WHERE c.user_id = ?
            ORDER BY c.created_at DESC
        `;

        const { results } = await db.prepare(query).bind(userId).all();

        // Calculate the cart subtotal on the backend
        const cartTotal = results.reduce((sum, item) => sum + item.total_price, 0);

        res.status(200).json({ success: true, cart: results, cartTotal });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// This endpoint handles two scenarios: if the service is already in the cart, it increments the quantity. If it's a new service, it inserts a new row. 
router.post('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { service_id, quantity = 1 } = req.body;

        if (!service_id) {
            return res.status(400).json({ success: false, message: "service_id is required" });
        }

        // Check if this service is already in the user's cart
        const existingItem = await db.prepare(
            'SELECT id, quantity FROM carts WHERE user_id = ? AND service_id = ?'
        ).bind(userId, service_id).first();

        if (existingItem) {
            // Update quantity
            const newQuantity = existingItem.quantity + quantity;
            await db.prepare(
                'UPDATE carts SET quantity = ? WHERE id = ?'
            ).bind(newQuantity, existingItem.id).run();

            return res.status(200).json({
                success: true,
                message: "Cart quantity updated",
                cart_item_id: existingItem.id
            });
        }

        // Insert new item
        const result = await db.prepare(
            'INSERT INTO carts (user_id, service_id, quantity) VALUES (?, ?, ?) RETURNING id'
        ).bind(userId, service_id, quantity).first();

        res.status(201).json({
            success: true,
            message: "Added to cart",
            cart_item_id: result.id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// When a user clicks "+" or "-" in the cart UI, use this to update the exact number.
router.patch('/:id', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const cartItemId = req.params.id;
        const { quantity } = req.body;

        if (!quantity || quantity < 1) {
            return res.status(400).json({ success: false, message: "Quantity must be at least 1" });
        }

        // The WHERE user_id = ? check ensures a user can't update someone else's cart!
        const result = await db.prepare(
            'UPDATE carts SET quantity = ? WHERE id = ? AND user_id = ?'
        ).bind(quantity, cartItemId, userId).run();

        // Check if any rows were actually updated
        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "Cart item not found" });
        }

        res.status(200).json({ success: true, message: "Quantity updated successfully" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const cartItemId = req.params.id;

        // Again, enforce user_id so users can only delete their own stuff
        const result = await db.prepare(
            'DELETE FROM carts WHERE id = ? AND user_id = ?'
        ).bind(cartItemId, userId).run();

        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "Cart item not found" });
        }

        res.status(200).json({ success: true, message: "Item removed from cart" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;