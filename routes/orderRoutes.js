const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { generateClosingMessage } = require('../services/closingMessageService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const pool = require('../db');
const { createOrderLimiter, generalLimiter } = require('../middleware/rateLimit');
const { logSecurityEvent } = require('../middleware/securityLogger');

// ตรวจสอบว่า orderId เป็นตัวเลขก่อนส่งเข้า database
// ป้องกัน database error message หลุดออกมา (เช่น "invalid input syntax for type integer")
function validateOrderId(req, res, next) {
  if (!/^\d+$/.test(req.params.orderId)) {
    logSecurityEvent('INVALID_ORDER_ID', req, { rawOrderId: req.params.orderId });
    return res.status(400).json({ status: 'ERROR', message: 'Invalid order ID' });
  }
  next();
}

// POST /api/orders
router.post('/', authenticateToken, createOrderLimiter, async (req, res) => {
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
router.get('/all', authenticateToken, requireRole('admin'), generalLimiter, async (req, res) => {
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
router.get('/restaurant', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const ownerUserId = req.user.userId;
    const result = await pool.query('SELECT id FROM restaurants WHERE owner_user_id = $1', [ownerUserId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'Restaurant not found for this owner' });
    }
    const restaurantIds = result.rows.map(r => r.id);
    const placeholders = restaurantIds.map((_, i) => `$${i + 1}`).join(', ');
    const ordersResult = await pool.query(
      `SELECT o.*, r.name as restaurant_name FROM orders o LEFT JOIN restaurants r ON o.restaurant_id = r.id WHERE o.restaurant_id IN (${placeholders}) ORDER BY o.created_at DESC`,
      restaurantIds
    );
    const orders = ordersResult.rows;
    return res.status(200).json({ status: 'OK', data: { orders } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get restaurant orders error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders/closing-message
// Returns the personalized AI closing message for the Confirmation screen,
// based on the customer's chosen Theme + Guest Count.
// Must stay above /:orderId so Express doesn't treat "closing-message" as an orderId.
router.get('/closing-message', authenticateToken, async (req, res) => {
  try {
    const { theme, guestCount } = req.query;
    const message = generateClosingMessage(theme, guestCount);
    return res.status(200).json({ status: 'OK', data: { message } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get closing message error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders
router.get('/', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const orders = await orderService.getUserOrders(req.user.userId);
    return res.status(200).json({ status: 'OK', data: orders });
  } catch (error) {
    logger.error({ error: error.message }, 'Get orders endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders/:orderId
router.get('/:orderId', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
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
        logSecurityEvent('IDOR_BLOCKED', req, { targetOrderId: req.params.orderId, action: 'view' });
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
router.patch('/:orderId/status', authenticateToken, validateOrderId, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ status: 'ERROR', message: 'Status is required' });
    }

    // State machine: บังคับลำดับ transition ที่ถูกต้อง (#4, #76)
    const VALID_TRANSITIONS = {
      'pending':    ['accepted', 'cancelled'],
      'accepted':   ['preparing', 'cancelled'],
      'preparing':  ['delivered', 'cancelled'],
      'delivered':  [],
      'cancelled':  [],
    };

    // --- IDOR protection: เฉพาะ admin หรือร้านที่เป็นเจ้าของ order นี้เท่านั้น ---
    const existing = await orderService.getOrderById(req.params.orderId);
    if (req.user.role !== 'admin') {
      const ownerCheck = await pool.query(
        'SELECT id FROM restaurants WHERE id = $1 AND owner_user_id = $2',
        [existing.restaurant_id, req.user.userId]
      );
      if (ownerCheck.rows.length === 0) {
        logSecurityEvent('IDOR_BLOCKED', req, { targetOrderId: req.params.orderId, action: 'update_status' });
        return res.status(403).json({ status: 'ERROR', message: 'Not authorized to update this order' });
      }
    }

    const currentStatus = existing.status;
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed) {
      return res.status(400).json({ status: 'ERROR', message: `Unknown current status: ${currentStatus}` });
    }
    if (!allowed.includes(status)) {
      return res.status(400).json({ status: 'ERROR', message: `Cannot transition from '${currentStatus}' to '${status}'` });
    }

    const order = await orderService.updateOrderStatus(req.params.orderId, status);
    return res.status(200).json({ status: 'OK', message: 'Order status updated', data: order });
  } catch (error) {
    logger.error({ error: error.message }, 'Update order status error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// PATCH /api/orders/:orderId/rating
router.patch('/:orderId/rating', authenticateToken, validateOrderId, async (req, res) => {
  try {
    const { rating, review } = req.body;

    if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return res.status(400).json({ status: 'ERROR', message: 'Rating must be an integer between 1 and 5' });
    }

    const existing = await orderService.getOrderById(req.params.orderId);

    // เฉพาะเจ้าของ order เท่านั้น
    if (existing.user_id !== req.user.userId) {
      logSecurityEvent('IDOR_BLOCKED', req, { targetOrderId: req.params.orderId, action: 'rate' });
      return res.status(403).json({ status: 'ERROR', message: 'Not authorized to rate this order' });
    }

    // ต้อง delivered แล้วเท่านั้น
    if (existing.status !== 'delivered') {
      return res.status(400).json({ status: 'ERROR', message: 'You can only rate delivered orders' });
    }

    // ห้ามแก้ rating ที่ส่งไปแล้ว
    if (existing.rating !== null) {
      return res.status(400).json({ status: 'ERROR', message: 'This order has already been rated' });
    }

    const order = await orderService.submitRating(req.params.orderId, rating, review);
    return res.status(200).json({ status: 'OK', message: 'Rating submitted', data: { order } });
  } catch (error) {
    logger.error({ error: error.message }, 'Submit rating error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
