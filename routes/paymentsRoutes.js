import express from 'express';
import { env } from "cloudflare:workers";
import { verifyToken, verifyAdmin } from "../middleware/auth";
import crypto from "crypto";

const router = express.Router();


// POST /payments/initiate
// Creates a pending payment record in DB, then calls Razorpay's Orders API
// to create a real order. Returns the razorpay_order_id for the frontend checkout modal.
router.post('/initiate', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { order_id, order_type = 'service' } = req.body;

        if (!order_id) {
            return res.status(400).json({ success: false, message: "order_id is required" });
        }

        if (!['service', 'food'].includes(order_type)) {
            return res.status(400).json({ success: false, message: 'Invalid order type' });
        }
        const orderTable = order_type === 'food' ? 'food_orders' : 'orders';
        const paymentTable = order_type === 'food' ? 'food_payment_details' : 'payment_details';
        const order = await db.prepare(
            `SELECT total_amount, payment_status FROM ${orderTable} WHERE id = ? AND user_id = ?`
        ).bind(order_id, userId).first();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        if (order.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: "Order is already paid" });
        }

        // 2. Convert amount to paise (Razorpay requires integer paise)
        const amountInPaise = Math.round(order.total_amount * 100);
        if (amountInPaise < 100) {
            return res.status(400).json({ success: false, message: "Minimum payable amount is ₹1" });
        }

        // 3. Create Razorpay order via their REST API
        const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
        const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

        const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(`${razorpayKeyId}:${razorpayKeySecret}`)
            },
            body: JSON.stringify({
                amount: amountInPaise,
                currency: 'INR',
                receipt: `order_${order_id}_${Date.now()}`
            })
        });

        if (!razorpayResponse.ok) {
            const errBody = await razorpayResponse.text();
            console.error('Razorpay order creation failed:', errBody);
            return res.status(500).json({ success: false, message: "Failed to create Razorpay order" });
        }

        const razorpayOrder = await razorpayResponse.json();

        // 4. Create a pending payment record in our DB, storing the razorpay_order_id
        const paymentColumn = order_type === 'food' ? 'food_order_id' : 'order_id';
        const paymentRecord = await db.prepare(`
            INSERT INTO ${paymentTable} (${paymentColumn}, user_id, amount, status, transaction_id)
            VALUES (?, ?, ?, 'pending', ?) RETURNING id
        `).bind(order_id, userId, order.total_amount, razorpayOrder.id).first();

        res.status(200).json({
            success: true,
            message: "Payment initiated",
            payment_id: paymentRecord.id,
            amount: order.total_amount,
            razorpay_order_id: razorpayOrder.id,
            razorpay_key_id: razorpayKeyId,
            currency: 'INR'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


// POST /payments/verify
// Receives razorpay_payment_id, razorpay_order_id, razorpay_signature from the frontend
// after the Razorpay checkout modal completes. Verifies the signature using HMAC-SHA256
// and marks the order as paid only if the signature is valid.
router.post('/verify', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const { order_id, razorpay_payment_id, razorpay_order_id, razorpay_signature, order_type = 'service' } = req.body;

        // Validate required fields
        if (!order_id || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: "Missing payment verification details" });
        }
        if (!['service', 'food'].includes(order_type)) {
            return res.status(400).json({ success: false, message: 'Invalid order type' });
        }
        const orderTable = order_type === 'food' ? 'food_orders' : 'orders';
        const paymentTable = order_type === 'food' ? 'food_payment_details' : 'payment_details';
        const paymentColumn = order_type === 'food' ? 'food_order_id' : 'order_id';

        // 1. Verify the payment signature
        //    Algorithm: HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, KEY_SECRET)
        const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
        const generatedSignature = crypto
            .createHmac('sha256', razorpayKeySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (generatedSignature !== razorpay_signature) {
            // Signature mismatch — do NOT mark as paid
            // Update payment record as failed
            await db.prepare(`
                UPDATE ${paymentTable}
                SET status = 'failed', payment_method = 'razorpay'
                WHERE transaction_id = ? AND ${paymentColumn} = ? AND user_id = ? AND status = 'pending'
            `).bind(razorpay_order_id, order_id, userId).run();

            return res.status(400).json({
                success: false,
                message: "Payment verification failed. Signature mismatch."
            });
        }

        // 2. Signature is valid — update DB in a batch transaction
        const statements = [];

        // Update payment_details: set status to success and store the actual payment ID
        statements.push(
            db.prepare(`
                UPDATE ${paymentTable}
                SET transaction_id = ?, payment_method = 'razorpay', status = 'success'
                WHERE transaction_id = ? AND ${paymentColumn} = ? AND user_id = ? AND status = 'pending'
            `).bind(razorpay_payment_id, razorpay_order_id, order_id, userId)
        );

        // Update the main orders table payment status
        statements.push(
            db.prepare(`
                UPDATE ${orderTable}
                SET payment_status = 'paid' 
                WHERE id = ? AND user_id = ? AND payment_status != 'paid'
            `).bind(order_id, userId)
        );

        const results = await db.batch(statements);

        if (results[0].meta.changes === 0) {
            return res.status(400).json({
                success: false,
                message: "No pending payment found for this order, or it has already been processed."
            });
        }

        res.status(200).json({
            success: true,
            message: "Payment verified and order marked as paid",
            order_id: order_id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


export default router;
