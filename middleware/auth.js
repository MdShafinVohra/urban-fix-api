import { getAdminAuth } from "../config/firebase";
import { env } from "cloudflare:workers";

export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    console.log(authHeader)

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: "UnAuthorized or Missing Token" });
    }

    const idToken = authHeader.split(' ')[1];


    try {
        // FIX 1: Call getAdminAuth() as a function
        const decodedToken = await getAdminAuth().verifyIdToken(idToken);

        const DBuser = await await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(decodedToken.email).first();

        req.user = decodedToken;
        req.dbUser = DBuser;
        console.log(`Token verified successfully for user: ${decodedToken.email}`);

        next();
    } catch (err) {
        console.error("Token verification error:", err.message);

        // TEMPORARY: Send the real error to the frontend so you can see it!
        res.status(401).json({
            success: false,
            error: err.message,
            stack: err.stack
        });
    }
}

export const verifyAdmin = async (req, res, next) => {
    try {
        // FIX 2: Use the dbUser we already fetched in verifyToken! No need to hit the database again.
        if (!req.dbUser || req.dbUser.role !== "ADMIN") {
            return res.status(403).json({ success: false, error: "Admin access required" });
        }

        next();
    } catch (err) {
        res.status(500).json({ success: false, error: "Server Error" });
    }
}

export const verifyAgent = async (req, res, next) => {
    try {
        if (!req.dbUser || req.dbUser.role !== "agent") {
            return res.status(403).json({ success: false, error: "Agent access required" });
        }

        const agent = await env.DB.prepare("SELECT * FROM agents WHERE email = ?").bind(req.dbUser.email).first();
        req.agent = agent;
        next();
    } catch (err) {
        res.status(500).json({ success: false, error: "Server Error" });
    }
}

export const verifyVendor = async (req, res, next) => {
    try {
        if (!req.dbUser || req.dbUser.role !== "VENDOR") {
            return res.status(403).json({ success: false, error: "Vendor access required" });
        }

        next();
    } catch (err) {
        res.status(500).json({ success: false, error: "Server Error" });
    }
}