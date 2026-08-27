import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin, verifyRestaurantOwner } from "../middleware/auth";

const router = express.Router();
const restaurantFields = ['name', 'description', 'address', 'city_id', 'image_url', 'owner_id'];
const menuFields = ['name', 'description', 'price', 'price_quarter', 'price_half', 'price_full', 'image_url', 'is_veg'];

function parseMenuPrices(values, current = {}) {
    const optionalPrice = (value) => value === null || value === undefined || value === '' ? null : Number(value);
    const quarter = optionalPrice(values.price_quarter ?? current.price_quarter);
    const half = optionalPrice(values.price_half ?? current.price_half);
    const full = Number(values.price_full ?? values.price ?? current.price_full ?? current.price);
    if (!Number.isFinite(full) || full <= 0) return null;
    if ([quarter, half].some((value) => value !== null && (!Number.isFinite(value) || value <= 0))) return null;
    return { quarter, half, full };
}

function parsePositiveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

async function requireRestaurantAccess(req, res, restaurantId) {
    const restaurant = await env.DB.prepare('SELECT * FROM restaurants WHERE id = ?').bind(restaurantId).first();
    if (!restaurant) {
        res.status(404).json({ success: false, message: 'Restaurant not found' });
        return null;
    }
    if (req.dbUser.role === 'ADMIN') return restaurant;
    if (req.dbUser.role !== 'RESTAURANT' || Number(restaurant.owner_id) !== Number(req.dbUser.id)) {
        res.status(403).json({ success: false, message: 'You can only manage your assigned restaurant' });
        return null;
    }
    return restaurant;
}

async function validateOwner(db, ownerId, restaurantId = null) {
    if (ownerId === null || ownerId === undefined || ownerId === '') return null;
    const owner = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'RESTAURANT'").bind(ownerId).first();
    if (!owner) return 'The selected owner is not a restaurant user';
    const assigned = await db.prepare('SELECT id FROM restaurants WHERE owner_id = ? AND id != COALESCE(?, -1)')
        .bind(ownerId, restaurantId).first();
    return assigned ? 'This restaurant user is already assigned to another restaurant' : null;
}

// Public restaurant discovery.
router.get('/', async (req, res) => {
    try {
        const { results } = await env.DB.prepare(`
            SELECT r.*, c.name AS city_name FROM restaurants r
            LEFT JOIN cities c ON r.city_id = c.id ORDER BY r.created_at DESC
        `).all();
        res.status(200).json({ success: true, restaurants: results });
    } catch (err) {
        console.error('Error fetching restaurants:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Full restaurant list for the admin panel, including owner information.
router.get('/admin/all', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { results } = await env.DB.prepare(`
            SELECT r.*, c.name AS city_name, u.name AS owner_name, u.email AS owner_email
            FROM restaurants r LEFT JOIN cities c ON r.city_id = c.id
            LEFT JOIN users u ON r.owner_id = u.id ORDER BY r.created_at DESC
        `).all();
        res.status(200).json({ success: true, restaurants: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// The one restaurant assigned to the signed-in restaurant user.
router.get('/owner/my-restaurant', verifyToken, verifyRestaurantOwner, async (req, res) => {
    try {
        const db = env.DB;
        const restaurant = await db.prepare(`
            SELECT r.*, c.name AS city_name FROM restaurants r
            LEFT JOIN cities c ON r.city_id = c.id WHERE r.owner_id = ?
        `).bind(req.dbUser.id).first();
        if (!restaurant) return res.status(404).json({ success: false, message: 'No restaurant has been assigned to you' });
        const { results: menu } = await db.prepare(
            'SELECT * FROM restaurant_menus WHERE restaurant_id = ? ORDER BY created_at DESC'
        ).bind(restaurant.id).all();
        res.status(200).json({ success: true, restaurant, menu });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Public restaurant and menu details.
router.get('/:id', async (req, res) => {
    try {
        const restaurantId = parsePositiveId(req.params.id);
        if (!restaurantId) return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        const db = env.DB;
        const restaurant = await db.prepare(`
            SELECT r.*, c.name AS city_name FROM restaurants r
            LEFT JOIN cities c ON r.city_id = c.id WHERE r.id = ?
        `).bind(restaurantId).first();
        if (!restaurant) return res.status(404).json({ success: false, message: 'Restaurant not found' });
        const { results: menu } = await db.prepare(
            'SELECT * FROM restaurant_menus WHERE restaurant_id = ? ORDER BY created_at DESC'
        ).bind(restaurantId).all();
        res.status(200).json({ success: true, restaurant, menu });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin restaurant CRUD.
router.post('/', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = env.DB;
        const { name, description = null, address, city_id, image_url = null, owner_id = null } = req.body;
        const cityId = parsePositiveId(city_id);
        const ownerId = owner_id === null || owner_id === '' ? null : parsePositiveId(owner_id);
        if (!name?.trim() || !address?.trim() || !cityId || (owner_id && !ownerId)) {
            return res.status(400).json({ success: false, message: 'Name, address, and a valid city are required' });
        }
        const ownerError = await validateOwner(db, ownerId);
        if (ownerError) return res.status(400).json({ success: false, message: ownerError });
        const result = await db.prepare(`
            INSERT INTO restaurants (name, description, address, city_id, image_url, owner_id)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id
        `).bind(name.trim(), description, address.trim(), cityId, image_url, ownerId).first();
        res.status(201).json({ success: true, message: 'Restaurant created', restaurant_id: result.id });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const restaurantId = parsePositiveId(req.params.id);
        if (!restaurantId) return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        const db = env.DB;
        const existing = await db.prepare('SELECT * FROM restaurants WHERE id = ?').bind(restaurantId).first();
        if (!existing) return res.status(404).json({ success: false, message: 'Restaurant not found' });
        const update = Object.fromEntries(restaurantFields.filter((key) => Object.hasOwn(req.body, key)).map((key) => [key, req.body[key]]));
        if (Object.keys(update).length === 0) return res.status(400).json({ success: false, message: 'No restaurant fields supplied' });
        const cityId = Object.hasOwn(update, 'city_id') ? parsePositiveId(update.city_id) : existing.city_id;
        const ownerId = Object.hasOwn(update, 'owner_id')
            ? (update.owner_id === null || update.owner_id === '' ? null : parsePositiveId(update.owner_id))
            : existing.owner_id;
        if (!cityId || (Object.hasOwn(update, 'owner_id') && update.owner_id && !ownerId)) {
            return res.status(400).json({ success: false, message: 'A valid city and owner are required' });
        }
        const ownerError = await validateOwner(db, ownerId, restaurantId);
        if (ownerError) return res.status(400).json({ success: false, message: ownerError });
        const values = {
            name: Object.hasOwn(update, 'name') ? String(update.name).trim() : existing.name,
            description: Object.hasOwn(update, 'description') ? update.description : existing.description,
            address: Object.hasOwn(update, 'address') ? String(update.address).trim() : existing.address,
            city_id: cityId,
            image_url: Object.hasOwn(update, 'image_url') ? update.image_url : existing.image_url,
            owner_id: ownerId,
        };
        if (!values.name || !values.address) return res.status(400).json({ success: false, message: 'Name and address cannot be empty' });
        await db.prepare(`UPDATE restaurants SET name = ?, description = ?, address = ?, city_id = ?, image_url = ?, owner_id = ? WHERE id = ?`)
            .bind(values.name, values.description, values.address, values.city_id, values.image_url, values.owner_id, restaurantId).run();
        res.status(200).json({ success: true, message: 'Restaurant updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const restaurantId = parsePositiveId(req.params.id);
        if (!restaurantId) return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        const result = await env.DB.prepare('DELETE FROM restaurants WHERE id = ?').bind(restaurantId).run();
        if (result.meta.changes === 0) return res.status(404).json({ success: false, message: 'Restaurant not found' });
        res.status(200).json({ success: true, message: 'Restaurant deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Menu CRUD: admins may manage any restaurant; restaurant users only their assigned one.
router.post('/:id/menu', verifyToken, async (req, res) => {
    try {
        const restaurantId = parsePositiveId(req.params.id);
        if (!restaurantId) return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        const restaurant = await requireRestaurantAccess(req, res, restaurantId);
        if (!restaurant) return;
        const { name, description = null, image_url = null, is_veg = true } = req.body;
        const prices = parseMenuPrices(req.body);
        if (!name?.trim() || !prices) {
            return res.status(400).json({ success: false, message: 'Name and a positive full price are required. Quarter and half prices are optional.' });
        }
        const result = await env.DB.prepare(`
            INSERT INTO restaurant_menus (restaurant_id, name, description, price, price_quarter, price_half, price_full, image_url, is_veg)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
        `).bind(restaurant.id, name.trim(), description, prices.full, prices.quarter, prices.half, prices.full, image_url, Boolean(is_veg)).first();
        res.status(201).json({ success: true, message: 'Menu item added', menu_item_id: result.id });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put('/:id/menu/:menuId', verifyToken, async (req, res) => {
    try {
        const restaurantId = parsePositiveId(req.params.id);
        const menuId = parsePositiveId(req.params.menuId);
        if (!restaurantId || !menuId) return res.status(400).json({ success: false, message: 'Invalid restaurant or menu item id' });
        const restaurant = await requireRestaurantAccess(req, res, restaurantId);
        if (!restaurant) return;
        const db = env.DB;
        const existing = await db.prepare('SELECT * FROM restaurant_menus WHERE id = ? AND restaurant_id = ?').bind(menuId, restaurant.id).first();
        if (!existing) return res.status(404).json({ success: false, message: 'Menu item not found' });
        const update = Object.fromEntries(menuFields.filter((key) => Object.hasOwn(req.body, key)).map((key) => [key, req.body[key]]));
        if (Object.keys(update).length === 0) return res.status(400).json({ success: false, message: 'No menu fields supplied' });
        const name = Object.hasOwn(update, 'name') ? String(update.name).trim() : existing.name;
        const prices = parseMenuPrices(update, existing);
        if (!name || !prices) return res.status(400).json({ success: false, message: 'Name and a positive full price are required. Quarter and half prices are optional.' });
        await db.prepare(`UPDATE restaurant_menus SET name = ?, description = ?, price = ?, price_quarter = ?, price_half = ?, price_full = ?, image_url = ?, is_veg = ? WHERE id = ?`)
            .bind(name, Object.hasOwn(update, 'description') ? update.description : existing.description, prices.full, prices.quarter, prices.half, prices.full,
                Object.hasOwn(update, 'image_url') ? update.image_url : existing.image_url,
                Object.hasOwn(update, 'is_veg') ? Boolean(update.is_veg) : existing.is_veg, menuId).run();
        res.status(200).json({ success: true, message: 'Menu item updated' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/:id/menu/:menuId', verifyToken, async (req, res) => {
    try {
        const restaurantId = parsePositiveId(req.params.id);
        const menuId = parsePositiveId(req.params.menuId);
        if (!restaurantId || !menuId) return res.status(400).json({ success: false, message: 'Invalid restaurant or menu item id' });
        const restaurant = await requireRestaurantAccess(req, res, restaurantId);
        if (!restaurant) return;
        const result = await env.DB.prepare('DELETE FROM restaurant_menus WHERE id = ? AND restaurant_id = ?').bind(menuId, restaurant.id).run();
        if (result.meta.changes === 0) return res.status(404).json({ success: false, message: 'Menu item not found' });
        res.status(200).json({ success: true, message: 'Menu item deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;
