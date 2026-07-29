import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";

const router = express.Router();


// This endpoint is called when the user clicks "Pay Now". It checks the order, creates a pending record in the payment_details table, and returns mock data that you would normally replace with a real SDK call to Stripe, Razorpay, etc.
router.post('/initiate', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { order_id } = req.body;

        if (!order_id) {
            return res.status(400).json({ success: false, message: "order_id is required" });
        }

        // 1. Fetch the order to ensure it belongs to the user and needs payment
        const order = await db.prepare(
            'SELECT total_amount, payment_status FROM orders WHERE id = ? AND user_id = ?'
        ).bind(order_id, userId).first();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        if (order.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: "Order is already paid" });
        }

        // 2. Create a pending payment record
        const paymentRecord = await db.prepare(`
            INSERT INTO payment_details (order_id, user_id, amount, status) 
            VALUES (?, ?, ?, 'pending') RETURNING id
        `).bind(order_id, userId, order.total_amount).first();

        // 3. TODO: In a real app, you call your payment gateway here
        // const gatewaySession = await stripe.checkout.sessions.create({...})

        res.status(200).json({
            success: true,
            message: "Payment initiated",
            payment_id: paymentRecord.id,
            amount: order.total_amount,
            // gateway_token: gatewaySession.id // Send token to frontend
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// After the user completes the payment on the frontend, your app calls this endpoint (or the payment gateway hits it via a Webhook). It updates the payment_details and then marks the actual orders table as paid using a batch transaction.
router.post('/verify', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { order_id, transaction_id, payment_method, payment_status } = req.body;

        // Ensure required fields are present
        if (!order_id || !transaction_id || !payment_status) {
            return res.status(400).json({ success: false, message: "Missing payment details" });
        }

        // Validate status
        if (!['success', 'failed'].includes(payment_status)) {
            return res.status(400).json({ success: false, message: "Invalid payment status" });
        }

        const statements = [];

        // 1. Update the payment_details record
        statements.push(
            db.prepare(`
                UPDATE payment_details 
                SET transaction_id = ?, payment_method = ?, status = ?
                WHERE order_id = ? AND user_id = ? AND status = 'pending'
            `).bind(transaction_id, payment_method || 'unknown', payment_status, order_id, userId)
        );

        // 2. If the payment was successful, update the main orders table
        if (payment_status === 'success') {
            statements.push(
                db.prepare(`
                    UPDATE orders 
                    SET payment_status = 'paid' 
                    WHERE id = ? AND user_id = ?
                `).bind(order_id, userId)
            );
        }

        // Execute both updates safely in a single batch
        const results = await db.batch(statements);

        // Check if the payment_details row was actually updated
        if (results[0].meta.changes === 0) {
            return res.status(400).json({
                success: false,
                message: "No pending payment found for this order, or it has already been processed."
            });
        }

        res.status(200).json({
            success: true,
            message: `Payment marked as ${payment_status}`,
            order_id: order_id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// Important Note: In a production environment, relying solely on the frontend to call /verify is risky because users might close their browser before the call finishes. You should eventually map this logic to a Webhook URL that your payment gateway (like Stripe) calls directly. When moving to webhooks, you would remove the verifyToken middleware and instead verify the gateway's cryptographic signature.

export default router;