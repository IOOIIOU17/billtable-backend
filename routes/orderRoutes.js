const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const pool = require('../db');

// POST /api/orders
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { restaurantId, items, theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude } = req.body;
    if (!restaurantId || !items) {
      return res.status(400).json({ status: 'ERROR', message: 'Restaurant ID and items are required' });
    }
    const order = await orderService.createOrder(req.user.userId, restaurantId, items, { theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude });
    return res.status(201).json({ status: 'OK', message: 'Order created successfully', data: order });
  } catch (error) {
    logger.error({ error: error.message }, 'Create order endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});


// GET /api/orders/all (Admin only)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, u.name as customer_name, u.email as customer_email,
       r.name as restaurant_name
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN restaurants r ON o.restaurant_id = r.id
       ORDER BY o.created_at DESC`
    );
    return res.status(200).json({ status: 'OK', data: { orders: result.rows } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get all orders error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders/restaurant
router.get('/restaurant', authenticateToken, async (req, res) => {
  try {
    const ownerUserId = req.user.userId;
    const result = await pool.query('SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1', [ownerUserId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'Restaurant not found for this owner' });
    }
    const restaurantId = result.rows[0].id;
    const orders = await orderService.getRestaurantOrders(restaurantId);
    return res.status(200).json({ status: 'OK', data: { orders } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get restaurant orders error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders
router.get('/', authenticateToken, async (req, res) => {
  try {
    const orders = await orderService.getUserOrders(req.user.userId);
    return res.status(200).json({ status: 'OK', data: orders });
  } catch (error) {
    logger.error({ error: error.message }, 'Get orders endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders/:orderId
router.get('/:orderId', authenticateToken, async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ status: 'ERROR', message: 'Order not found' });
    }

    // --- IDOR protection: เช็คว่ามีสิทธิ์ดู order นี้จริงไหม ---
    if (req.user.role !== 'admin' && order.user_id !== req.user.userId) {
      const ownerCheck = await pool.query(
        'SELECT id FROM restaurants WHERE id = $1 AND owner_user_id = $2',
        [order.restaurant_id, req.user.userId]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(403).json({ status: 'ERROR', message: 'Not authorized to view this order' });
      }
    }

    return res.status(200).json({ status: 'OK', data: { order } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// PATCH /api/orders/:orderId/status
router.patch('/:orderId/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ status: 'ERROR', message: 'Status is required' });
    }

    // --- IDOR protection: เฉพาะ admin หรือร้านที่เป็นเจ้าของ order นี้เท่านั้น ---
    const existing = await orderService.getOrderById(req.params.orderId);
    if (req.user.role !== 'admin') {
      const ownerCheck = await pool.query(
        'SELECT id FROM restaurants WHERE id = $1 AND owner_user_id = $2',
        [existing.restaurant_id, req.user.userId]
      );
      if (ownerCheck.rows.length === 0) {
        return res.status(403).json({ status: 'ERROR', message: 'Not authorized to update this order' });
      }
    }

    const order = await orderService.updateOrderStatus(req.params.orderId, status);
    return res.status(200).json({ status: 'OK', message: 'Order status updated', data: order });
  } catch (error) {
    logger.error({ error: error.message }, 'Update order status error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
