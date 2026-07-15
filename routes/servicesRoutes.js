import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();

// GET: Fetch all services
router.get('/', async (req, res) => {
    try {
        const db = env.DB;

        const query = `
            SELECT 
                s.id, 
                s.name, 
                s.price, 
                s.description, 
                s.image_url, -- Added image_url
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

// POST: Create a new service
router.post('/', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = env.DB;
        // Extract imageUrl from req.body
        const { name, category_id, sub_category_id, description, price, city_ids, imageUrl } = req.body;

        if (!name || !category_id || !sub_category_id || !price || !city_ids || !city_ids.length) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // Include image_url in the INSERT statement
        const serviceInsert = await db.prepare(`
            INSERT INTO services (name, category_id, sub_category_id, price, description, image_url)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
        `).bind(name, category_id, sub_category_id, price, description, imageUrl || null).first();

        const serviceId = serviceInsert.id;

        const cityStatements = city_ids.map(cityId => {
            return db.prepare(`
                INSERT INTO service_cities (service_id, city_id) 
                VALUES (?, ?)
            `).bind(serviceId, cityId);
        });

        try {
            await db.batch(cityStatements);
        } catch (batchErr) {
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
        const { name, imageUrl } = req.body; // Added imageUrl

        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        const result = await db.prepare('INSERT INTO categories (name, image_url) VALUES (?, ?) RETURNING id, name, image_url')
            .bind(name, imageUrl || null).first();

        res.status(201).json({ success: true, category: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all categories
router.get('/categories', async (req, res) => {
    try {
        const db = env.DB;
        // Select image_url so the frontend can display it
        const { results } = await db.prepare('SELECT id, name, image_url FROM categories ORDER BY name').all();
        res.status(200).json({ success: true, categories: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST: Create a new sub-category
router.post('/sub-categories', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = env.DB;
        const { name, category_id, imageUrl } = req.body; // Added imageUrl

        if (!name || !category_id) {
            return res.status(400).json({ success: false, message: "Name and category_id are required" });
        }

        const result = await db.prepare('INSERT INTO sub_categories (category_id, name, image_url) VALUES (?, ?, ?) RETURNING id, category_id, name, image_url')
            .bind(category_id, name, imageUrl || null).first();

        res.status(201).json({ success: true, sub_category: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all sub-categories
router.get('/sub-categories', async (req, res) => {
    try {
        const db = env.DB;
        // Select image_url
        const { results } = await db.prepare('SELECT id, category_id, name, image_url FROM sub_categories ORDER BY name').all();
        res.status(200).json({ success: true, sub_categories: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST: Create a new city
router.post('/cities', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = env.DB;
        const { name, imageUrl } = req.body; // Added imageUrl

        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        // Update INSERT to include image_url
        const result = await db.prepare('INSERT INTO cities (name, image_url) VALUES (?, ?) RETURNING id, name, image_url')
            .bind(name, imageUrl || null).first();

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
        // Select image_url so the frontend can display it
        const { results } = await db.prepare('SELECT id, name, image_url FROM cities ORDER BY name').all();
        res.status(200).json({ success: true, cities: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch a single service by ID
router.get('/:id', async (req, res) => {
    try {
        const db = env.DB; // Fixed from req.env.DB to env.DB
        const serviceId = req.params.id;

        const query = `
            SELECT 
                s.id, 
                s.name, 
                s.price, 
                s.description, 
                s.image_url, -- Added image_url to the select statement
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