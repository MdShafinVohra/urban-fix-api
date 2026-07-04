import express from "express";
import { expect } from "vitest";
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();

// Get All Users
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { results } = await env.DB.prepare('SELECT * FROM users').all();
        res.json({ success: true, users: results });
    } catch (err) {
        res.status(500).send(err.message);
    }
});


// Sign Up
router.post("/", verifyToken, async (req, res) => {
    // try {

    const email = req.user.email;
    const { userName, role } = req.body;

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

    const results = await env.DB.prepare("INSERT INTO users (user_name, email, role, created_at) VALUES (?, ?, ?, ?)").bind(userName, email, role, created_at).run();
    console.log(results);

    if (results.success) {
        res.status(201).json({
            success: true,
            message: "member created successfully",
            id: results.meta.last_row_id
        });
        console.log(`Member created successfully with ID: ${results.meta.last_row_id}`);
    } else {
        res.status(500).json({
            success: false,
            error: "Failed to create Member"
        });
    }

    // } catch (err) {
    //     res.status(500).send(err.message);
    // }
})

module.exports = router;