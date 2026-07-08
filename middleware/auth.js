import { adminAuth } from "../config/firebase.js";
import { env } from "cloudflare:workers";

// export async function verifyToken(req, res, next) {
export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const DBuser = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: "UnAuthorized or Missing Token" });
    }

    const idToken = authHeader.split(' ')[1];
    console.log(authHeader.split('Bearer '));

    try {
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        req.user = decodedToken;
        req.dbUser = DBuser;
        console.log(`Token verified successfully for user: ${decodedToken.email}`);
        next();
    } catch (err) {
        res.status(500).send(err.message);
    }
}

export const verifyAdmin = async (req, res, next) => {
    try {
        const email = req.user.email;
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();

        if (!user || user.role !== "ADMIN") {
            return res.status(403).json({ success: false, error: "Admin access required" });
        }


        next();
    } catch (err) {
        res.status(500).json({ success: false, error: "Unauthorized" });
    }
}

export const verifyAgent = async (req, res, next) => {
    try {
        const email = req.user.email;
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();

        if (!user || user.role !== "AGENT") {
            return res.status(403).json({ success: false, error: "Agent access required" });
        }


        next();
    } catch (err) {
        res.status(500).json({ success: false, error: "Unauthorized" });
    }
}

export const verifyVendor = async (req, res, next) => {
    try {
        const email = req.user.email;
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();

        if (!user || user.role !== "VENDOR") {
            return res.status(403).json({ success: false, error: "Vendor access required" });
        }


        next();
    } catch (err) {
        res.status(500).json({ success: false, error: "Unauthorized" });
    }
}