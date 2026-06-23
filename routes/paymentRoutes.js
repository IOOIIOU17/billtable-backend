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

    // บันทึก payment_intent_id ลง DB เพื่อใช้ตอน refund
    await pool.query(
      'UPDATE orders SET payment_intent_id = $1 WHERE id = $2',
      [paymentIntent.id, orderId]
    );

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

// GET /api/payments/restaurant/:restaurantId — ร้านดู payout history
router.get('/restaurant/:restaurantId', authenticateToken, async (req, res) => {
  try {
    const restaurantId = parseInt(req.params.restaurantId, 10);
    if (isNaN(restaurantId)) return res.status(400).json({ status: 'ERROR', message: 'Invalid restaurant ID' });

    // เช็คว่าเป็นเจ้าของร้านหรือ admin
    if (req.user.role !== 'admin') {
      const ownerCheck = await pool.query(
        'SELECT id FROM restaurants WHERE id = $1 AND owner_user_id = $2',
        [restaurantId, req.user.userId]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
      }
    }

    const result = await pool.query(
      `SELECT id, order_number, total_amount, status, refund_status, refund_percent,
              payment_intent_id, created_at, updated_at
       FROM orders WHERE restaurant_id = $1
       ORDER BY created_at DESC`,
      [restaurantId]
    );

    const commission = 0.10;
    const delivery = 0.05;
    const hidden = 0.03;
    const payoutRate = 1 - commission - delivery - hidden;

    const orders = result.rows.map(o => ({
      ...o,
      payout: o.refund_status === 'full' ? 0 :
              o.refund_status === 'partial' ? parseFloat(o.total_amount) * payoutRate * (1 - (o.refund_percent || 0) / 100) :
              parseFloat(o.total_amount) * payoutRate,
    }));

    return res.status(200).json({ status: 'OK', data: orders });
  } catch (error) {
    logger.error({ error: error.message }, 'Get restaurant payments error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/payments/refund
router.post('/refund', authenticateToken, async (req, res) => {
  try {
    const { orderId, refundType, refundPercent } = req.body;
    if (!orderId || !refundType) {
      return res.status(400).json({ status: 'ERROR', message: 'orderId and refundType are required' });
    }

    const orderResult = await pool.query(
      'SELECT id, total_amount, status, restaurant_id, payment_intent_id FROM orders WHERE id = $1',
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'Order not found' });
    }
    const order = orderResult.rows[0];

    // เฉพาะร้านที่เป็นเจ้าของ order หรือ admin
    if (req.user.role !== 'admin') {
      const ownerCheck = await pool.query(
        'SELECT id FROM restaurants WHERE id = $1 AND owner_user_id = $2',
        [order.restaurant_id, req.user.userId]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
      }
    }

    const percent = refundType === 'full' ? 100 : (refundPercent || 50);
    const totalAmount = parseFloat(order.total_amount);
    const refundAmountCents = Math.round((totalAmount * percent / 100) * 100);

    // ถ้ามี payment_intent_id เรียก Stripe Refund จริง
    let stripeRefundId = null;
    if (order.payment_intent_id) {
      const refund = await stripe.refunds.create({
        payment_intent: order.payment_intent_id,
        amount: refundAmountCents,
      });
      stripeRefundId = refund.id;
    }

    const newStatus = refundType === 'full' ? 'cancelled' : order.status;
    await pool.query(
      'UPDATE orders SET status = $1, refund_percent = $2, refund_status = $3, updated_at = NOW() WHERE id = $4',
      [newStatus, percent, refundType === 'full' ? 'full' : 'partial', orderId]
    );

    logger.info({ orderId, percent, stripeRefundId }, 'Refund processed');
    return res.status(200).json({ status: 'OK', message: 'Refund processed', refundPercent: percent, stripeRefundId });
  } catch (error) {
    logger.error({ error: error.message }, 'Refund error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/payments/webhook
// Stripe webhook — source of truth สำหรับสถานะการจ่ายเงิน
// ต้อง parse raw body (ไม่ใช่ JSON) เพื่อ verify signature
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error({ error: err.message }, 'Webhook signature verification failed');
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata?.orderId;

      if (orderId) {
        await pool.query(
          `UPDATE orders SET status = 'accepted', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
          [orderId]
        );
        logger.info({ orderId, paymentIntentId: paymentIntent.id }, 'Payment succeeded — order accepted');
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata?.orderId;
      if (orderId) {
        logger.warn({ orderId, paymentIntentId: paymentIntent.id }, 'Payment failed');
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error({ error: error.message }, 'Webhook handler error');
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
});

module.exports = router;
