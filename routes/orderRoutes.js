const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { generateClosingMessage } = require('../services/closingMessageService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const pool = require('../db');
const { createOrderLimiter, generalLimiter, createRateLimiter } = require('../middleware/rateLimit');
const { partyAccess, hostOnly } = require('../middleware/partyAccess');
const partyService = require('../services/partyService');
const issueService = require('../services/issueService');
const { whyNot } = require('../utils/availability');
const { pushToRestaurant, pushToCustomer } = require('../services/pushService');
const { cleanMessage } = require('../utils/chatFilter');
const { sendChatReportAlert, sendReceiptToCustomer, sendPhotoReportAlert } = require('../services/emailService');
const photoService = require('../services/photoService');
const upload = require('../middleware/upload');

// Passcode guesses are limited so a code can't be brute-forced.
const joinLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000,
  message: 'Too many tries. Wait a minute and try the passcode again.',
});
const { sendOrderNotificationToRestaurant, sendOrderConfirmationToCustomer } = require('../services/emailService');
const { logSecurityEvent } = require('../middleware/securityLogger');
const { notifyRestaurantNewOrder } = require('../services/pushService');

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
    const { restaurantId, items, theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude, budgetWarningShown, budgetWarningAcknowledged, customerComment, cateringOptions } = req.body;
    if (!restaurantId || !items) {
      return res.status(400).json({ status: 'ERROR', message: 'Restaurant ID and items are required' });
    }
    // Same capacity rules as matching, checked again here so an order can
    // never reach a restaurant that is busy, closed then, or given too
    // little notice. Food total is checked inside createOrder's pricing.
    const rest = await pool.query('SELECT * FROM restaurants WHERE id = $1 AND is_deleted = false', [restaurantId]);
    if (rest.rows.length === 0 || !rest.rows[0].is_active) {
      return res.status(400).json({ status: 'ERROR', message: 'This restaurant is not taking orders right now.' });
    }
    const capacityProblem = whyNot(rest.rows[0], { deliveryTime });
    if (capacityProblem) {
      return res.status(400).json({ status: 'ERROR', message: capacityProblem });
    }
    // budgetWarning* and customerComment were sent by both customer apps but
    // dropped here, so they were never saved -- the restaurant never saw the
    // customer's note and the budget-warning flags were always false.
    // Fixed 2026-10-02. Comment is capped at 500 chars.
    const order = await orderService.createOrder(req.user.userId, restaurantId, items, {
      theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude,
      budgetWarningShown: budgetWarningShown === true,
      budgetWarningAcknowledged: budgetWarningAcknowledged === true,
      customerComment: typeof customerComment === 'string' ? (customerComment.trim().slice(0, 500) || null) : null,
    });
    // Catering extras (plates & cutlery, set-up). Only known yes/no keys are kept.
    if (cateringOptions && typeof cateringOptions === 'object') {
      const opts = { utensils: cateringOptions.utensils === true, setup: cateringOptions.setup === true };
      await pool.query('UPDATE orders SET catering_options = $1 WHERE id = $2', [JSON.stringify(opts), order.id]);
      order.catering_options = opts;
    }

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
    // Push notify the restaurant right away (web push + Expo). Never blocks the response.
    notifyRestaurantNewOrder(restaurantId, order).catch((e) => {
      logger.warn({ error: e.message, orderId: order.id }, 'notifyRestaurantNewOrder failed');
    });

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

    // The restaurant can call the customer on the party day (last-minute
    // changes): name + the phone from the customer's delivery address.
    if (order.user_id !== req.user.userId) {
      const c = await pool.query(
        `SELECT u.name,
                (SELECT phone FROM delivery_addresses d WHERE d.user_id = u.id AND COALESCE(d.phone, '') <> ''
                  ORDER BY d.created_at DESC LIMIT 1) AS phone
           FROM users u WHERE u.id = $1`,
        [order.user_id]
      );
      order.customer_name = c.rows[0]?.name || null;
      order.customer_phone = c.rows[0]?.phone || null;
    }
    return res.status(200).json({ status: 'OK', data: { order } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

async function sendReceiptForOrder(orderId) {
  const r = await pool.query(
    `SELECT o.*, u.email AS customer_email, u.name AS customer_name, r.name AS restaurant_name, r.address AS restaurant_address
       FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = r.rows[0];
  if (!o || !o.customer_email) return;
  const items = await pool.query('SELECT item_name, quantity, total_price FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  await sendReceiptToCustomer({
    customerEmail: o.customer_email,
    customerName: o.customer_name,
    orderNumber: o.order_number,
    restaurantName: o.restaurant_name,
    restaurantAddress: o.restaurant_address,
    deliveryTime: o.delivery_time,
    items: items.rows,
    subtotal: o.subtotal,
    taxAmount: o.tax_amount,
    taxRate: o.tax_rate,
    total: o.total_amount,
  });
}

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
    if (status === 'delivered') {
      sendReceiptForOrder(req.params.orderId).catch((e) => logger.error({ error: e.message }, 'Receipt email failed'));
    }
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

    // Delivered (catering) or completed (dine-in party) only
    if (!['delivered', 'completed'].includes(existing.status)) {
      return res.status(400).json({ status: 'ERROR', message: 'You can rate the restaurant after your party' });
    }

    // ห้ามแก้ rating ที่ส่งไปแล้ว
    if (existing.rating !== null) {
      return res.status(400).json({ status: 'ERROR', message: 'This order has already been rated' });
    }

    const cleanReview = typeof review === 'string' && review.trim() ? cleanMessage(review.trim().slice(0, 500)) : null;
    const order = await orderService.submitRating(req.params.orderId, rating, cleanReview);
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
router.get('/:orderId/table', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    const order = await orderService.getTableView(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: { order } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get table view error');
    return res.status(404).json({ status: 'ERROR', message: 'Order not found' });
  }
});

// GET /api/orders/:orderId/members
router.get('/:orderId/members', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    const members = await orderService.getOrderMembers(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: { members } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order members error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/members  { name }
router.post('/:orderId/members', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'Name is required' });
    }
    const member = await orderService.addOrderMember(req.params.orderId, name.trim().slice(0, 100), req.user.userId);
    return res.status(201).json({ status: 'OK', data: { member } });
  } catch (error) {
    logger.error({ error: error.message }, 'Add order member error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/items  { menuItemId, quantity, addedBy } — open ordering
router.post('/:orderId/items', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
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
router.delete('/:orderId/items/:itemId', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
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
router.get('/:orderId/activities', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    const activities = await orderService.getOrderActivities(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: { activities } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order activities error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/activities  { title, time, createdBy }
router.post('/:orderId/activities', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
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
router.get('/:orderId/messages', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    const sinceId = req.query.sinceId && /^\d+$/.test(req.query.sinceId) ? req.query.sinceId : null;
    const messages = await orderService.getOrderMessages(req.params.orderId, sinceId, req.user.userId);
    return res.status(200).json({ status: 'OK', data: { messages } });
  } catch (error) {
    logger.error({ error: error.message }, 'Get order messages error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/messages  { senderName, message }
router.post('/:orderId/messages', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    const { senderName, message } = req.body;
    if (!senderName || !senderName.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'senderName is required' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ status: 'ERROR', message: 'Message is required' });
    }
    const saved = await orderService.addOrderMessage(
      req.params.orderId,
      senderName.trim().slice(0, 100),
      cleanMessage(message.trim().slice(0, 1000)),
      req.user.userId
    );
    return res.status(201).json({ status: 'OK', data: { message: saved } });
  } catch (error) {
    logger.error({ error: error.message }, 'Add order message error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// ============================================================
// Party access + chat moderation (migration 008)
// ============================================================

// GET /api/orders/:orderId/invite — host sees the party passcode
router.get('/:orderId/invite', authenticateToken, validateOrderId, generalLimiter, partyAccess, hostOnly, async (req, res) => {
  try {
    const invite = await partyService.getInvite(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: invite });
  } catch (error) {
    logger.error({ error: error.message }, 'Get invite error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// PUT /api/orders/:orderId/invite  { passcode } — host changes it
router.put('/:orderId/invite', authenticateToken, validateOrderId, generalLimiter, partyAccess, hostOnly, async (req, res) => {
  try {
    const invite = await partyService.setPasscode(req.params.orderId, req.body?.passcode);
    return res.status(200).json({ status: 'OK', data: invite });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/join  { passcode, name } — guest joins
router.post('/:orderId/join', authenticateToken, validateOrderId, joinLimiter, async (req, res) => {
  try {
    const result = await partyService.joinParty(req.params.orderId, req.user.userId, req.body?.name, req.body?.passcode);
    return res.status(200).json({ status: 'OK', data: result });
  } catch (error) {
    if (error.statusCode === 403) logSecurityEvent('PARTY_PASSCODE_WRONG', req, { targetOrderId: req.params.orderId });
    return res.status(error.statusCode || 400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/messages/:messageId/report  { reason }
router.post('/:orderId/messages/:messageId/report', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.messageId)) return res.status(400).json({ status: 'ERROR', message: 'Invalid message ID' });
    const msg = await partyService.reportMessage(req.params.orderId, req.params.messageId, req.user.userId, req.body?.reason);
    sendChatReportAlert({
      orderId: req.params.orderId,
      messageId: req.params.messageId,
      senderName: msg.sender_name,
      message: msg.message,
      reason: req.body?.reason,
      reporterId: req.user.userId,
    }).catch((e) => logger.error({ error: e.message }, 'Chat report email failed'));
    return res.status(200).json({ status: 'OK', data: { reported: true } });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ status: 'ERROR', message: error.message });
  }
});

// ---- Party photos: host cover photos + shared Memory album (migration 014) ----
// GET /api/orders/:orderId/photos — host, members (and admin)
router.get('/:orderId/photos', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    if (!['host', 'member', 'admin'].includes(req.partyRole)) return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
    return res.status(200).json({ status: 'OK', data: await photoService.listPhotos(req.params.orderId) });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/photos  multipart: image, kind=cover|memory
router.post('/:orderId/photos', authenticateToken, validateOrderId, generalLimiter, partyAccess, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ status: 'ERROR', message: 'Add a photo' });
    const photo = await photoService.addPhoto({
      orderId: req.params.orderId,
      userId: req.user.userId,
      kind: req.body?.kind === 'cover' ? 'cover' : 'memory',
      buffer: req.file.buffer,
      role: req.partyRole,
    });
    return res.status(201).json({ status: 'OK', data: { photo } });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ status: 'ERROR', message: error.message });
  }
});

// DELETE /api/orders/:orderId/photos/:photoId — the person who added it, or the host
router.delete('/:orderId/photos/:photoId', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.photoId)) return res.status(400).json({ status: 'ERROR', message: 'Invalid photo ID' });
    await photoService.removePhoto({ orderId: req.params.orderId, photoId: req.params.photoId, userId: req.user.userId, role: req.partyRole });
    return res.status(200).json({ status: 'OK' });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/photos/:photoId/report — hides it at once + emails BillTable
router.post('/:orderId/photos/:photoId/report', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.photoId)) return res.status(400).json({ status: 'ERROR', message: 'Invalid photo ID' });
    const p = await photoService.reportPhoto({ orderId: req.params.orderId, photoId: req.params.photoId, userId: req.user.userId });
    sendPhotoReportAlert({ orderId: req.params.orderId, photoId: p.id, url: p.url, uploaderName: p.uploader_name, reporterId: req.user.userId })
      .catch((e) => logger.error({ error: e.message }, 'Photo report email failed'));
    return res.status(200).json({ status: 'OK', data: { reported: true } });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/on-the-way — restaurant: the food has left the kitchen
router.post('/:orderId/on-the-way', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    if (!['restaurant', 'admin'].includes(req.partyRole)) return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
    const r = await pool.query(
      `UPDATE orders SET on_the_way_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status IN ('accepted', 'preparing') RETURNING id, user_id, order_number, delivery_time, on_the_way_at`,
      [req.params.orderId]
    );
    if (r.rows.length === 0) return res.status(400).json({ status: 'ERROR', message: 'Only an accepted or cooking order can go out.' });
    const o = r.rows[0];
    pushToCustomer(o.user_id, {
      type: 'on_the_way',
      title: 'Your food is on the way',
      body: `${o.order_number} has left the kitchen.`,
      orderId: o.id,
    }).catch((e) => logger.error({ error: e.message }, 'On-the-way push failed'));
    return res.status(200).json({ status: 'OK', data: { on_the_way_at: o.on_the_way_at } });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// ---- Problem with my order (migration 009) ----
const ISSUE_LABEL = { missing_item: 'Missing item', wrong_item: 'Wrong item', late: 'Late', quality: 'Food quality', other: 'Other' };

// GET /api/orders/:orderId/issues — host or restaurant
router.get('/:orderId/issues', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    if (!['host', 'restaurant', 'admin'].includes(req.partyRole)) return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
    const issues = await issueService.listIssues(req.params.orderId);
    return res.status(200).json({ status: 'OK', data: { issues } });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/issues  { issueType, message, wantsRefund } — host only
router.post('/:orderId/issues', authenticateToken, validateOrderId, generalLimiter, partyAccess, hostOnly, async (req, res) => {
  try {
    const issue = await issueService.createIssue(req.params.orderId, req.user.userId, req.body || {});
    pushToRestaurant(req.partyOrder.restaurant_id, {
      type: 'order_issue',
      title: 'A customer reported a problem',
      body: `${ISSUE_LABEL[issue.issue_type] || 'Problem'}${issue.wants_refund ? ' · asks for a refund' : ''}`,
      orderId: Number(req.params.orderId),
    }).catch((e) => logger.error({ error: e.message }, 'Issue push failed'));
    return res.status(201).json({ status: 'OK', data: { issue } });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// PATCH /api/orders/:orderId/issues/:issueId  { reply, resolve } — restaurant
router.patch('/:orderId/issues/:issueId', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    if (!['restaurant', 'admin'].includes(req.partyRole)) return res.status(403).json({ status: 'ERROR', message: 'Not authorized' });
    if (!/^\d+$/.test(req.params.issueId)) return res.status(400).json({ status: 'ERROR', message: 'Invalid issue ID' });
    const issue = await issueService.replyToIssue(req.params.orderId, req.params.issueId, req.body?.reply, req.body?.resolve);
    pushToCustomer(req.partyOrder.user_id, {
      type: 'order_issue_reply',
      title: 'The restaurant replied',
      body: issue.restaurant_reply ? String(issue.restaurant_reply).slice(0, 120) : 'Your problem report was updated.',
      orderId: Number(req.params.orderId),
    }).catch((e) => logger.error({ error: e.message }, 'Issue reply push failed'));
    return res.status(200).json({ status: 'OK', data: { issue } });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/orders/:orderId/block  { userId } — stop seeing someone's messages
router.post('/:orderId/block', authenticateToken, validateOrderId, generalLimiter, partyAccess, async (req, res) => {
  try {
    const result = await partyService.blockUser(req.user.userId, Number(req.body?.userId));
    return res.status(200).json({ status: 'OK', data: result });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
