import { adminAuth } from "../config/firebase.js";
import { env } from "cloudflare:workers";

// export async function verifyToken(req, res, next) {
export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: "UnAuthorized or Missing Token" });
    }

    const idToken = authHeader.split(' ')[1];
    console.log(authHeader.split(authHeader, "Bearer "));

    try {
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        req.user = decodedToken;
        console.log(`Token verified successfully for user: ${decodedToken.email}`);
        next();
    } catch (err) {
        res.status(500).send(err.message);
    }
}

export const verifyAdmin = async (req, res, next) => {
    try {
        const email = req.user.email;
        const user = env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).run();

        console.log(user);

    } catch (err) {
        res.status(401).json({ success: false, error: "UnAutorized" })
    }
}