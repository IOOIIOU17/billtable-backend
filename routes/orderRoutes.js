const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { generateClosingMessage } = require('../services/closingMessageService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const pool = require('../db');
const { createOrderLimiter, generalLimiter } = require('../middleware/rateLimit');
const { sendOrderNotificationToRestaurant, sendOrderConfirmationToCustomer } = require('../services/emailService');
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

    // ดึงข้อมูลร้านและลูกค้าเพื่อส่ง email
    const restaurantResult = await pool.query('SELECT name, email FROM restaurants WHERE id = $1', [restaurantId]);
    const userResult = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.user.userId]);
    const orderItemsResult = await pool.query('SELECT item_name, quantity FROM order_items WHERE order_id = $1', [order.id]);
    const restaurant = restaurantResult.rows[0];
    const user = userResult.rows[0];

    // ส่ง email แจ้งร้าน
    if (restaurant?.email) {
      sendOrderNotificationToRestaurant({
        restaurantEmail: restaurant.email,
        restaurantName: restaurant.name,
        orderNumber: order.order_number,
        theme, guestCount, deliveryTime, deliveryAddress,
        items: orderItemsResult.rows,
        subtotal: order.subtotal,
        platformFee: order.platform_fee,
        deliveryFeeAmount: order.delivery_fee_amount,
        restaurantPayout: order.restaurant_payout,
        taxAmount: order.tax_amount,
        taxRate: order.tax_rate,
      }).catch(() => {});
    }

    // ส่ง email ยืนยันลูกค้า
    if (user?.email) {
      sendOrderConfirmationToCustomer({
        customerEmail: user.email,
        customerName: user.name,
        orderNumber: order.order_number,
        restaurantName: restaurant?.name,
        theme, deliveryTime,
      }).catch(() => {});
    }
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
       r.name as restaurant_name, r.phone as restaurant_phone
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

// POST /api/orders/:orderId/refund (restaurant only)
router.post('/:orderId/refund', authenticateToken, validateOrderId, async (req, res) => {
  try {
    const { refundType, refundPercent } = req.body;
    if (!['partial', 'full'].includes(refundType)) {
      return res.status(400).json({ status: 'ERROR', message: 'refundType must be partial or full' });
    }
    if (refundType === 'partial' && (typeof refundPercent !== 'number' || refundPercent < 10 || refundPercent > 90)) {
      return res.status(400).json({ status: 'ERROR', message: 'refundPercent must be between 10 and 90' });
    }

    const existing = await orderService.getOrderById(req.params.orderId);
    if (!existing) return res.status(404).json({ status: 'ERROR', message: 'Order not found' });

    const ownerCheck = await pool.query(
      'SELECT id FROM restaurants WHERE id = $1 AND owner_user_id = $2',
      [existing.restaurant_id, req.user.userId]
    );
    if (req.user.role !== 'admin' && ownerCheck.rows.length === 0) {
      return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
    }

    if (!['delivered', 'accepted', 'preparing'].includes(existing.status)) {
      return res.status(400).json({ status: 'ERROR', message: 'Cannot refund order in current status' });
    }

    const percent = refundType === 'full' ? 100 : refundPercent;
    const newStatus = refundType === 'full' ? 'cancelled' : existing.status;
    const refundStatus = refundType === 'full' ? 'full' : 'partial';

    await pool.query(
      'UPDATE orders SET status = $1, refund_percent = $2, refund_status = $3, updated_at = NOW() WHERE id = $4',
      [newStatus, percent, refundStatus, req.params.orderId]
    );

    logger.info({ orderId: req.params.orderId, refundType, percent }, 'Refund processed');
    return res.status(200).json({ status: 'OK', message: `Refund ${refundType} processed`, refundPercent: percent });
  } catch (error) {
    logger.error({ error: error.message }, 'Refund error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// ============================================================
// Table Home (Phase 3 / Feature 2 & 3) — Members, open ordering
// with per-item attribution, and Party Activities.
//
// NOTE on auth: any authenticated BillTable user who knows the numeric
// orderId can join/add here — there is no real "invited member" check
// yet. Real access control arrives with Phase 8 (QR + Passcode invite).
// ============================================================

// GET /api/orders/:orderId/table
// Safe, ownership-unrestricted view for Table Home — anyone authenticated
// who knows the orderId (host or a QR-invited guest) can load the table.
// Does NOT expose the full /:orderId payload's owner-only fields; just
// enough to render the table (restaurant, theme, guests, items).
router.get('/:orderId/table', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const order = await orderService.getTableView(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: { order } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get table view error');
    return res.status(404).json({ status: 'ERROR', message: 'Order not found' });
  }
});

// GET /api/orders/:orderId/members
router.get('/:orderId/members', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const members = await orderService.getOrderMembers(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: { members } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order members error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/members  { name }
router.post('/:orderId/members', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'Name is required' });
    }
    const member = await orderService.addOrderMember(req.params.orderId, name.trim().slice(0, 100));
    return res.status(201).json({ status: 'OK', data: { member } });
  } catch (error) {
    logger.error({ error: error.message }, 'Add order member error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/items  { menuItemId, quantity, addedBy } — open ordering
router.post('/:orderId/items', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const { menuItemId, quantity, addedBy } = req.body;
    if (!menuItemId || !addedBy || !addedBy.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'menuItemId and addedBy are required' });
    }
    const result = await orderService.addPartyItem(req.params.orderId, menuItemId, quantity, addedBy.trim().slice(0, 100));
    return res.status(201).json({ status: 'OK', data: result });
  } catch (error) {
    logger.error({ error: error.message }, 'Add party item error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// DELETE /api/orders/:orderId/items/:itemId  { addedBy } — decrement by 1 / remove
router.delete('/:orderId/items/:itemId', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const { addedBy } = req.body;
    const result = await orderService.removePartyItem(req.params.orderId, req.params.itemId, addedBy);
    return res.status(200).json({ status: 'OK', data: result });
  } catch (error) {
    logger.error({ error: error.message }, 'Remove party item error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders/:orderId/activities
router.get('/:orderId/activities', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const activities = await orderService.getOrderActivities(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: { activities } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order activities error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/activities  { title, time, createdBy }
router.post('/:orderId/activities', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const { title, time, createdBy } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'Title is required' });
    }
    const activity = await orderService.addOrderActivity(req.params.orderId, title.trim().slice(0, 150), time, createdBy);
    return res.status(201).json({ status: 'OK', data: { activity } });
  } catch (error) {
    logger.error({ error: error.message }, 'Add order activity error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/orders/:orderId/messages?sinceId=123 — chat history (or just
// new messages since sinceId, for polling).
router.get('/:orderId/messages', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const sinceId = req.query.sinceId && /^\d+$/.test(req.query.sinceId) ? req.query.sinceId : null;
    const messages = await orderService.getOrderMessages(req.params.orderId, sinceId);
    return res.status(200).json({ status: 'OK', data: { messages } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order messages error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/messages  { senderName, message }
router.post('/:orderId/messages', authenticateToken, validateOrderId, generalLimiter, async (req, res) => {
  try {
    const { senderName, message } = req.body;
    if (!senderName || !senderName.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'senderName is required' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'Message is required' });
    }
    const saved = await orderService.addOrderMessage(req.params.orderId, senderName.trim().slice(0, 100), message.trim().slice(0, 1000));
    return res.status(201).json({ status: 'OK', data: { message: saved } });
  } catch (error) {
    logger.error({ error: error.message }, 'Add order message error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
