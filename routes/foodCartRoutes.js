import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken } from "../middleware/auth";

const router = express.Router();

// GET: Fetch user's food cart
router.get('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;

        const query = `
            SELECT 
                fc.id as cart_item_id, 
                fc.quantity, 
                rm.id as menu_item_id, 
                rm.name, 
                rm.price, 
                rm.image_url,
                rm.is_veg,
                rm.restaurant_id,
                r.name as restaurant_name
            FROM food_carts fc
            JOIN restaurant_menus rm ON fc.menu_item_id = rm.id
            JOIN restaurants r ON rm.restaurant_id = r.id
            WHERE fc.user_id = ?
        `;
        const { results } = await db.prepare(query).bind(userId).all();

        res.status(200).json({ success: true, cart: results });
    } catch (err) {
        console.error("Error fetching food cart:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST: Add or update item in food cart
router.post('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { menu_item_id, quantity } = req.body;

        if (!menu_item_id || quantity === undefined) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // First, check if the user already has items in the cart from a different restaurant
        // Zomato usually only allows ordering from one restaurant at a time.
        const currentCart = await db.prepare(`
            SELECT rm.restaurant_id 
            FROM food_carts fc
            JOIN restaurant_menus rm ON fc.menu_item_id = rm.id
            WHERE fc.user_id = ? LIMIT 1
        `).bind(userId).first();

        const itemToAdd = await db.prepare(`SELECT restaurant_id FROM restaurant_menus WHERE id = ?`).bind(menu_item_id).first();

        if (!itemToAdd) {
            return res.status(404).json({ success: false, message: "Menu item not found" });
        }

        if (currentCart && currentCart.restaurant_id !== itemToAdd.restaurant_id) {
            return res.status(400).json({ 
                success: false, 
                message: "Cart contains items from a different restaurant. Clear cart first." 
            });
        }

        if (quantity <= 0) {
            // Remove item
            await db.prepare(`DELETE FROM food_carts WHERE user_id = ? AND menu_item_id = ?`).bind(userId, menu_item_id).run();
            return res.status(200).json({ success: true, message: "Item removed from cart" });
        }

        // Check if item exists in cart
        const existing = await db.prepare(`SELECT id FROM food_carts WHERE user_id = ? AND menu_item_id = ?`).bind(userId, menu_item_id).first();

        if (existing) {
            await db.prepare(`UPDATE food_carts SET quantity = ? WHERE id = ?`).bind(quantity, existing.id).run();
        } else {
            await db.prepare(`INSERT INTO food_carts (user_id, menu_item_id, quantity) VALUES (?, ?, ?)`).bind(userId, menu_item_id, quantity).run();
        }

        res.status(200).json({ success: true, message: "Cart updated successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE: Clear food cart
router.delete('/', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;

        await db.prepare(`DELETE FROM food_carts WHERE user_id = ?`).bind(userId).run();
        res.status(200).json({ success: true, message: "Cart cleared" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
