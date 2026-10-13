import express from 'express';
import { env } from 'cloudflare:workers';
import { verifyToken } from '../middleware/auth';
import crypto from 'crypto';

const router = express.Router();

function parsePositiveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function hasValidRazorpaySignature(orderId, paymentId, signature, secret) {
    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

// Creates a Razorpay order for a food order that belongs to the signed-in user.
router.post('/initiate', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const orderId = parsePositiveId(req.body?.order_id);

        if (!orderId) {
            return res.status(400).json({ success: false, message: 'A valid food order_id is required' });
        }

        const order = await db.prepare(`
            SELECT total_amount, payment_status, status
            FROM food_orders
            WHERE id = ? AND user_id = ?
        `).bind(orderId, userId).first();

        if (!order) {
            return res.status(404).json({ success: false, message: 'Food order not found' });
        }
        if (order.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'A cancelled food order cannot be paid' });
        }
        if (order.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'This food order is already paid' });
        }

        const amountInPaise = Math.round(Number(order.total_amount) * 100);
        if (!Number.isSafeInteger(amountInPaise) || amountInPaise < 100) {
            return res.status(400).json({ success: false, message: 'Minimum payable amount is ₹1' });
        }

        const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
        const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
        if (!razorpayKeyId || !razorpayKeySecret) {
            console.error('Razorpay credentials are not configured');
            return res.status(500).json({ success: false, message: 'Payment service is unavailable' });
        }

        const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`,
            },
            body: JSON.stringify({
                amount: amountInPaise,
                currency: 'INR',
                receipt: `food_${orderId}_${Date.now()}`,
            }),
        });

        if (!razorpayResponse.ok) {
            console.error('Razorpay food order creation failed:', await razorpayResponse.text());
            return res.status(502).json({ success: false, message: 'Failed to create Razorpay order' });
        }

        const razorpayOrder = await razorpayResponse.json();
        const payment = await db.prepare(`
            INSERT INTO food_payment_details (food_order_id, user_id, transaction_id, amount, status)
            VALUES (?, ?, ?, ?, 'pending')
            RETURNING id
        `).bind(orderId, userId, razorpayOrder.id, order.total_amount).first();

        return res.status(200).json({
            success: true,
            payment_id: payment.id,
            amount: Number(order.total_amount),
            currency: 'INR',
            razorpay_order_id: razorpayOrder.id,
            razorpay_key_id: razorpayKeyId,
        });
    } catch (err) {
        console.error('Food payment initiation failed:', err);
        return res.status(500).json({ success: false, message: 'Unable to initiate food payment' });
    }
});

// Verifies the Razorpay signature before marking the food order as paid.
router.post('/verify', verifyToken, async (req, res) => {
    try {
        const db = await env.DB;
        const userId = req.dbUser.id;
        const orderId = parsePositiveId(req.body?.order_id);
        const { razorpay_payment_id: paymentId, razorpay_order_id: razorpayOrderId, razorpay_signature: signature } = req.body || {};

        if (!orderId || typeof paymentId !== 'string' || typeof razorpayOrderId !== 'string' || typeof signature !== 'string' || !paymentId || !razorpayOrderId || !signature) {
            return res.status(400).json({ success: false, message: 'Missing payment verification details' });
        }

        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (!secret) {
            console.error('Razorpay secret is not configured');
            return res.status(500).json({ success: false, message: 'Payment service is unavailable' });
        }

        const pendingPayment = await db.prepare(`
            SELECT id
            FROM food_payment_details
            WHERE food_order_id = ? AND user_id = ? AND transaction_id = ? AND status = 'pending'
        `).bind(orderId, userId, razorpayOrderId).first();

        if (!pendingPayment) {
            return res.status(400).json({ success: false, message: 'No pending payment was found for this food order' });
        }

        if (!hasValidRazorpaySignature(razorpayOrderId, paymentId, signature, secret)) {
            await db.prepare(`
                UPDATE food_payment_details
                SET status = 'failed', payment_method = 'razorpay'
                WHERE id = ? AND status = 'pending'
            `).bind(pendingPayment.id).run();
            return res.status(400).json({ success: false, message: 'Payment verification failed' });
        }

        const results = await db.batch([
            db.prepare(`
                UPDATE food_payment_details
                SET transaction_id = ?, payment_method = 'razorpay', status = 'success'
                WHERE id = ? AND status = 'pending'
            `).bind(paymentId, pendingPayment.id),
            db.prepare(`
                UPDATE food_orders
                SET payment_status = 'paid'
                WHERE id = ? AND user_id = ? AND payment_status != 'paid'
            `).bind(orderId, userId),
        ]);

        if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
            return res.status(400).json({ success: false, message: 'Food payment has already been processed' });
        }

        return res.status(200).json({ success: true, message: 'Food payment verified', order_id: orderId });
    } catch (err) {
        console.error('Food payment verification failed:', err);
        return res.status(500).json({ success: false, message: 'Unable to verify food payment' });
    }
});

export default router;
