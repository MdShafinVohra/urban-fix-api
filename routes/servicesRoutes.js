import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();

// GET: Fetch all services
router.get('/', async (req, res) => {
    try {
        const db = env.DB; // Adjust this if your D1 binding is named differently

        // This query joins all necessary tables and groups the cities into a JSON array string
        const query = `
            SELECT 
                s.id, 
                s.name, 
                s.price, 
                s.description, 
                s.created_at,
                c.id as category_id,
                c.name as category_name, 
                sc.id as sub_category_id,
                sc.name as sub_category_name,
                (
                    SELECT json_group_array(
                        json_object('id', cities.id, 'name', cities.name)
                    )
                    FROM service_cities
                    JOIN cities ON service_cities.city_id = cities.id
                    WHERE service_cities.service_id = s.id
                ) as cities
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            LEFT JOIN sub_categories sc ON s.sub_category_id = sc.id
            ORDER BY s.created_at DESC
        `;

        const { results } = await db.prepare(query).all();

        // SQLite's json_group_array returns a stringified JSON array. 
        // We need to parse it back into a real JavaScript array before sending it to the frontend.
        const formattedServices = results.map(service => ({
            ...service,
            cities: JSON.parse(service.cities)
        }));

        res.status(200).json({ success: true, services: formattedServices });

    } catch (err) {
        console.error("Error fetching services:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Note: Ensure your D1 binding is accessible in this route. 
// Depending on your framework (Hono, Itty Router, etc.), it might be in env.DB, env.DB, or c.env.DB
router.post('/', verifyToken, verifyAdmin, async (req, res) => {
    try {
        // Adjust this variable to match how your D1 binding is passed to your router
        const db = env.DB;

        const { name, category_id, sub_category_id, description, price, city_ids } = req.body;

        // Basic validation
        if (!name || !category_id || !sub_category_id || !price || !city_ids || !city_ids.length) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // 1. Insert the service and grab the new ID
        // D1 supports standard SQLite 'RETURNING', which we use with .first() to immediately get the ID
        const serviceInsert = await db.prepare(`
            INSERT INTO services (name, category_id, sub_category_id, price, description)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
        `).bind(name, category_id, sub_category_id, price, description).first();

        const serviceId = serviceInsert.id;

        // 2. Prepare the statements for the junction table
        const cityStatements = city_ids.map(cityId => {
            return db.prepare(`
                INSERT INTO service_cities (service_id, city_id) 
                VALUES (?, ?)
            `).bind(serviceId, cityId);
        });

        try {
            // 3. Execute all city links in a single D1 batch transaction
            await db.batch(cityStatements);
        } catch (batchErr) {
            // 4. Manual rollback
            // If linking the cities fails (e.g., invalid city_id), delete the newly created service 
            // so we don't leave orphaned data in the database.
            await db.prepare(`DELETE FROM services WHERE id = ?`).bind(serviceId).run();
            throw new Error(`Failed to link cities: ${batchErr.message}. Service creation aborted.`);
        }

        res.status(201).json({
            success: true,
            message: "Service created successfully",
            service_id: serviceId
        });

    } catch (err) {
        console.error(err);

        // Handle D1 specific unique constraint errors (e.g., duplicate service name)
        if (err.message.includes("D1_ERROR") || err.message.includes("UNIQUE constraint")) {
            return res.status(409).json({ success: false, message: "A service with this name already exists." });
        }

        res.status(500).json({ success: false, message: err.message });
    }
});


// POST: Create a new category
router.post('/categories', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = env.DB;
        const { name } = req.body;

        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        const result = await db.prepare('INSERT INTO categories (name) VALUES (?) RETURNING id, name')
            .bind(name).first();

        res.status(201).json({ success: true, category: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all categories
router.get('/categories', async (req, res) => {
    try {
        const db = env.DB;
        const { results } = await db.prepare('SELECT id, name FROM categories ORDER BY name').all();
        res.status(200).json({ success: true, categories: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// POST: Create a new sub-category
router.post('/sub-categories', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = env.DB;
        const { name, category_id } = req.body;

        if (!name || !category_id) {
            return res.status(400).json({ success: false, message: "Name and category_id are required" });
        }

        const result = await db.prepare('INSERT INTO sub_categories (category_id, name) VALUES (?, ?) RETURNING id, category_id, name')
            .bind(category_id, name).first();

        res.status(201).json({ success: true, sub_category: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all sub-categories
router.get('/sub-categories', async (req, res) => {
    try {
        const db = env.DB;
        const { results } = await db.prepare('SELECT id, category_id, name FROM sub_categories ORDER BY name').all();
        res.status(200).json({ success: true, sub_categories: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// POST: Create a new city
router.post('/cities', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = env.DB;
        const { name } = req.body;

        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        const result = await db.prepare('INSERT INTO cities (name) VALUES (?) RETURNING id, name')
            .bind(name).first();

        res.status(201).json({ success: true, city: result });
    } catch (err) {
        // Handle unique constraint if city already exists
        if (err.message.includes("UNIQUE")) {
            return res.status(409).json({ success: false, message: "City already exists" });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all cities
router.get('/cities', async (req, res) => {
    try {
        const db = env.DB;
        const { results } = await db.prepare('SELECT id, name FROM cities ORDER BY name').all();
        res.status(200).json({ success: true, cities: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch a single service by ID
router.get('/:id', async (req, res) => {
    try {
        const db = req.env.DB;
        const serviceId = req.params.id; // Note: if using Hono, this might be req.param('id')

        const query = `
            SELECT 
                s.id, 
                s.name, 
                s.price, 
                s.description, 
                s.created_at,
                c.id as category_id,
                c.name as category_name, 
                sc.id as sub_category_id,
                sc.name as sub_category_name,
                (
                    SELECT json_group_array(
                        json_object('id', cities.id, 'name', cities.name)
                    )
                    FROM service_cities
                    JOIN cities ON service_cities.city_id = cities.id
                    WHERE service_cities.service_id = s.id
                ) as cities
            FROM services s
            LEFT JOIN categories c ON s.category_id = c.id
            LEFT JOIN sub_categories sc ON s.sub_category_id = sc.id
            WHERE s.id = ?
        `;

        // Use .first() to get the single object instead of an array
        const service = await db.prepare(query).bind(serviceId).first();

        // Check if the service actually exists
        if (!service) {
            return res.status(404).json({ success: false, message: "Service not found" });
        }

        // Parse the stringified JSON array of cities
        service.cities = JSON.parse(service.cities);

        res.status(200).json({ success: true, service });

    } catch (err) {
        console.error(`Error fetching service ${req.params.id}:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

export default router;