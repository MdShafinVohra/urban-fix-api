import express from "express";
import { expect } from "vitest";
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();

// GET /users/me
router.get("/me", verifyToken, async (req, res) => {
    try {
        const email = req.user.email; // From your verifyToken middleware

        // Fetch the user from D1
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();

        if (!user) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        res.status(200).json({ success: true, user });
    } catch (err) {
        console.error("GET /users/me error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get All Users
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { results } = await env.DB.prepare('SELECT * FROM users').all();
        res.json({ success: true, users: results });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.post("/login", verifyToken, async (req, res) => {
    console.log("Login Endpoint");
    res.status(200).json({ success: true, message: "Login Success", dbUser: req.dbUser });
});

// Sign Up
router.post("/", verifyToken, async (req, res) => {
    try {
        const email = req.user.email;
        // 1. Extract imageUrl (or image key) from the request body
        const { userName, imageUrl } = req.body;
        const role = "USER";

        if (!userName || !email || !role) {
            return res.status(400).json({ success: false, error: "Missing Required Values" });
        }

        // Email Validation
        if (!email.includes("@") || !email.includes(".")) {
            return res.status(400).json({
                success: false,
                error: "Invalid Email Format"
            });
        }

        const created_at = new Date().toISOString().split("T")[0];

        // 2. Update the SQL query and bindings to include image_url
        const results = await env.DB.prepare(
            "INSERT INTO users (user_name, email, role, created_at, image_url) VALUES (?, ?, ?, ?, ?)"
        ).bind(userName, email, role, created_at, imageUrl || null).run();

        console.log(results);

        if (results.success) {
            res.status(201).json({
                success: true,
                message: "member created successfully",
                id: results.meta.last_row_id,
                dbUser: req.dbUser // Assuming this is populated by verifyToken middleware
            });
            console.log(`Member created successfully with ID: ${results.meta.last_row_id}`);
        } else {
            res.status(500).json({
                success: false,
                error: "Failed to create Member"
            });
        }

    } catch (err) {
        console.error("POST /users Error:", err);
        res.status(500).send(err.message);
    }
});

module.exports = router;