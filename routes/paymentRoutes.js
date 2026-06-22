const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

// POST /api/payments/create-intent
// ลูกค้าสร้าง PaymentIntent ก่อนจ่ายเงิน
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ status: 'ERROR', message: 'orderId is required' });

    // ดึง order จาก DB เพื่อเอา total_amount จริง (ไม่เชื่อ client)
    const orderResult = await pool.query(
      'SELECT id, total_amount, status, user_id, order_number FROM orders WHERE id = $1',
      [orderId]
    );
    if (orderResult.rows.length === 0) return res.status(404).json({ status: 'ERROR', message: 'Order not found' });

    const order = orderResult.rows[0];

    // เฉพาะเจ้าของ order เท่านั้น
    if (order.user_id !== req.user.userId) {
      return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ status: 'ERROR', message: 'Order is not in pending status' });
    }

    // สร้าง PaymentIntent (amount เป็น cents)
    const amountInCents = Math.round(parseFloat(order.total_amount) * 100);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      metadata: {
        orderId: order.id.toString(),
        orderNumber: order.order_number,
        userId: order.user_id.toString(),
      },
    });

    logger.info({ orderId, amountInCents }, 'PaymentIntent created');
    return res.status(200).json({
      status: 'OK',
      clientSecret: paymentIntent.client_secret,
      amount: order.total_amount,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Create payment intent error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
