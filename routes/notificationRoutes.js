const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// POST /api/notifications/subscribe
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { subscription, userType } = req.body;
    const userId = req.user.userId;
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, user_type, subscription, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, user_type) DO UPDATE SET subscription = $3`,
      [userId, userType || 'customer', JSON.stringify(subscription)]
    );
    return res.status(200).json({ status: 'OK', message: 'Subscribed' });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/notifications/send-restaurant (notify restaurant of new order)
// SECURITY FIX: previously trusted restaurantId/orderId/orderNumber directly
// from req.body with no ownership check — any logged-in user could spam
// fake "New Order" notifications to any restaurant.
// Now: only orderId is accepted from client. restaurantId and orderNumber
// are derived from the database, and we verify the caller actually owns
// the order before sending anything.
router.post('/send-restaurant', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.body;
    const userId = req.user.userId;

    if (!orderId) {
      return res.status(400).json({ status: 'ERROR', message: 'orderId is required' });
    }

    const orderResult = await pool.query(
      'SELECT user_id, restaurant_id, order_number FROM orders WHERE id = $1',
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'Order not found' });
    }

    const { user_id, restaurant_id, order_number } = orderResult.rows[0];

    if (user_id !== userId) {
      return res.status(403).json({ status: 'ERROR', message: 'You do not have permission to notify for this order' });
    }

    if (!restaurant_id) {
      return res.status(200).json({ status: 'OK', message: 'No restaurant linked to this order' });
    }

    const result = await pool.query(
      `SELECT ps.subscription FROM push_subscriptions ps
       JOIN restaurants r ON r.owner_user_id = ps.user_id
       WHERE r.id = $1 AND ps.user_type = 'restaurant'`,
      [restaurant_id]
    );
    if (result.rows.length === 0) {
      return res.status(200).json({ status: 'OK', message: 'No subscription found' });
    }
    const subscription = JSON.parse(result.rows[0].subscription);
    try {
      const pushResult = await webpush.sendNotification(subscription, JSON.stringify({
        title: '🔔 New Order!',
        body: `Order #${order_number} is waiting for your confirmation.`,
        orderId
      }));
      console.log('WEBPUSH_SUCCESS:', JSON.stringify(pushResult));
      return res.status(200).json({ status: 'OK', message: 'Notification sent' });
    } catch (pushError) {
      console.log('WEBPUSH_FAILED:', pushError.statusCode, pushError.body, pushError.message);
      return res.status(200).json({ status: 'OK', message: 'Push failed but logged', debug: pushError.message });
    }
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/notifications/notify-customer (restaurant notifies customer to pick up)
// SECURITY FIX: previously any logged-in user (including a different
// restaurant) could notify any customer for any orderId. Now we verify
// the caller owns the restaurant linked to this order before sending.
router.post('/notify-customer', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.body;
    const userId = req.user.userId;

    if (!orderId) {
      return res.status(400).json({ status: 'ERROR', message: 'orderId is required' });
    }

    const orderResult = await pool.query(
      `SELECT o.user_id, o.order_number, o.restaurant_id, r.owner_user_id
       FROM orders o
       LEFT JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.id = $1`,
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'Order not found' });
    }

    const { user_id, order_number, restaurant_id, owner_user_id } = orderResult.rows[0];

    if (!restaurant_id || owner_user_id !== userId) {
      return res.status(403).json({ status: 'ERROR', message: 'You do not have permission to notify for this order' });
    }

    const subResult = await pool.query(
      'SELECT subscription FROM push_subscriptions WHERE user_id = $1 AND user_type = $2',
      [user_id, 'customer']
    );
    if (subResult.rows.length === 0) return res.status(200).json({ status: 'OK', message: 'No subscription' });
    const subscription = JSON.parse(subResult.rows[0].subscription);
    await webpush.sendNotification(subscription, JSON.stringify({
      title: '🚗 Your order has arrived!',
      body: `Order #${order_number} is here. Please come down to receive it.`,
      orderId
    }));
    return res.status(200).json({ status: 'OK', message: 'Customer notified' });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
