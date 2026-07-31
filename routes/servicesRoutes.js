import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();

// GET: Fetch all services
router.get('/', async (req, res) => {
    try {
        const db = await env.DB;

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
        const db = await env.DB;
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

// PUT: Update an existing service
router.put('/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const serviceId = req.params.id;
        const { name, category_id, sub_category_id, description, price, city_ids, imageUrl } = req.body;

        if (!name || !category_id || !sub_category_id || !price || !city_ids || !city_ids.length) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // We only update the image_url if a new one is provided.
        // Wait, the client will send the *existing* image URL if it didn't change, 
        // or a *new* image URL if they uploaded one.
        // So we can just blindly update it to imageUrl.
        const updateQuery = `
            UPDATE services 
            SET name = ?, category_id = ?, sub_category_id = ?, price = ?, description = ?, image_url = COALESCE(?, image_url)
            WHERE id = ?
        `;
        
        await db.prepare(updateQuery)
            .bind(name, category_id, sub_category_id, price, description, imageUrl || null, serviceId)
            .run();

        // Re-link cities (delete old links, insert new ones)
        const statements = [
            db.prepare(`DELETE FROM service_cities WHERE service_id = ?`).bind(serviceId)
        ];

        city_ids.forEach(cityId => {
            statements.push(
                db.prepare(`INSERT INTO service_cities (service_id, city_id) VALUES (?, ?)`).bind(serviceId, cityId)
            );
        });

        await db.batch(statements);

        res.status(200).json({ success: true, message: "Service updated successfully" });

    } catch (err) {
        console.error(err);
        if (err.message.includes("UNIQUE constraint")) {
            return res.status(409).json({ success: false, message: "A service with this name already exists." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE: Delete a service
router.delete('/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const serviceId = req.params.id;

        // The 'services' table is referenced by 'ordered_items' with ON DELETE RESTRICT.
        // D1 will throw a constraint error if we try to delete it while it's in use.
        const result = await db.prepare('DELETE FROM services WHERE id = ?').bind(serviceId).run();
        
        if (result.meta.changes === 0) {
             return res.status(404).json({ success: false, message: "Service not found" });
        }

        res.status(200).json({ success: true, message: "Service deleted successfully" });
    } catch (err) {
        console.error("Delete Service Error:", err);
        // Handle RESTRICT constraint failure
        if (err.message.includes("FOREIGN KEY constraint failed") || err.message.includes("RESTRICT")) {
            return res.status(400).json({ success: false, message: "Cannot delete this service because it has been ordered by customers." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST: Create a new category
router.post('/categories', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const { name, imageUrl } = req.body; // Added imageUrl

        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        const result = await db.prepare('INSERT INTO categories (name, image_url) VALUES (?, ?) RETURNING id, name, image_url')
            .bind(name, imageUrl || null).first();

        res.status(201).json({ success: true, category: result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PUT: Update an existing category
router.put('/categories/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const categoryId = req.params.id;
        const { name, imageUrl } = req.body;

        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        const result = await db.prepare('UPDATE categories SET name = ?, image_url = COALESCE(?, image_url) WHERE id = ?')
            .bind(name, imageUrl || null, categoryId).run();
            
        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        res.status(200).json({ success: true, message: "Category updated successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE: Delete a category
router.delete('/categories/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const categoryId = req.params.id;

        const result = await db.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();
        
        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        res.status(200).json({ success: true, message: "Category deleted successfully" });
    } catch (err) {
        if (err.message.includes("FOREIGN KEY constraint failed") || err.message.includes("RESTRICT")) {
            return res.status(400).json({ success: false, message: "Cannot delete this category because it has services attached to it." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all categories
router.get('/categories', async (req, res) => {
    try {
        const db = await env.DB;
        // Select image_url so the frontend can display it
        const { results } = await db.prepare('SELECT id, name, image_url FROM categories ORDER BY name').all();
        console.log(results);
        res.status(200).json({ success: true, categories: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST: Create a new sub-category
router.post('/sub-categories', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
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

// PUT: Update an existing sub-category
router.put('/sub-categories/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const subCategoryId = req.params.id;
        const { name, category_id, imageUrl } = req.body;

        if (!name || !category_id) {
            return res.status(400).json({ success: false, message: "Name and category_id are required" });
        }

        const result = await db.prepare('UPDATE sub_categories SET name = ?, category_id = ?, image_url = COALESCE(?, image_url) WHERE id = ?')
            .bind(name, category_id, imageUrl || null, subCategoryId).run();
            
        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "Sub-category not found" });
        }

        res.status(200).json({ success: true, message: "Sub-category updated successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE: Delete a sub-category
router.delete('/sub-categories/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const subCategoryId = req.params.id;

        const result = await db.prepare('DELETE FROM sub_categories WHERE id = ?').bind(subCategoryId).run();
        
        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "Sub-category not found" });
        }

        res.status(200).json({ success: true, message: "Sub-category deleted successfully" });
    } catch (err) {
        if (err.message.includes("FOREIGN KEY constraint failed") || err.message.includes("RESTRICT")) {
            return res.status(400).json({ success: false, message: "Cannot delete this sub-category because it has services attached to it." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all sub-categories
router.get('/sub-categories', async (req, res) => {
    try {
        const db = await env.DB;
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
        const db = await env.DB;
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

// PUT: Update an existing city
router.put('/cities/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const cityId = req.params.id;
        const { name, imageUrl } = req.body;

        if (!name) return res.status(400).json({ success: false, message: "Name is required" });

        const result = await db.prepare('UPDATE cities SET name = ?, image_url = COALESCE(?, image_url) WHERE id = ?')
            .bind(name, imageUrl || null, cityId).run();
            
        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "City not found" });
        }

        res.status(200).json({ success: true, message: "City updated successfully" });
    } catch (err) {
        if (err.message.includes("UNIQUE")) {
            return res.status(409).json({ success: false, message: "City already exists" });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE: Delete a city
router.delete('/cities/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const db = await env.DB;
        const cityId = req.params.id;

        const result = await db.prepare('DELETE FROM cities WHERE id = ?').bind(cityId).run();
        
        if (result.meta.changes === 0) {
            return res.status(404).json({ success: false, message: "City not found" });
        }

        res.status(200).json({ success: true, message: "City deleted successfully" });
    } catch (err) {
        if (err.message.includes("FOREIGN KEY constraint failed") || err.message.includes("RESTRICT")) {
            return res.status(400).json({ success: false, message: "Cannot delete this city because it is referenced elsewhere (e.g. agents or orders)." });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET: Fetch all cities
router.get('/cities', async (req, res) => {
    try {
        const db = await env.DB;
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
        const db = await env.DB; // Fixed from await env.DB to await env.DB
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