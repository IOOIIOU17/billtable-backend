const pool = require('../db');
const { logger } = require('../middleware/logger');

// Create Order
const createOrder = async (userId, restaurantId, items, extra = {}) => {
  try {
    const orderNumber = 'BT-' + Date.now().toString().slice(-6) + Math.random().toString(36).slice(2, 6).toUpperCase();
    const { theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude, budgetWarningShown, budgetWarningAcknowledged, customerComment } = extra;

    // Verify all menuItemIds exist and belong to this restaurant, then get real prices from DB
    const menuIds = items.map((item) => item.menuItemId);
    const menuResult = await pool.query(
      'SELECT id, name, price FROM menus WHERE id = ANY($1) AND restaurant_id = $2 AND is_available = true',
      [menuIds, restaurantId]
    );
    if (menuResult.rows.length !== items.length) {
      throw new Error('One or more menu items are invalid or unavailable');
    }
    const priceMap = {};
    for (const row of menuResult.rows) {
      priceMap[row.id] = { name: row.name, price: parseFloat(row.price) };
    }

    // Calculate total using DB prices only — never trust client-supplied price
    const TAX_RATE = extra.taxRate || 0.0875; // Default 8.75% (CA) — overridable per ZIP later
    const PLATFORM_FEE_RATE = 0.10; // 10% platform commission

    let foodTotal = 0;
    const resolvedItems = items.map((item) => {
      const menu = priceMap[item.menuItemId];
      const qty = Math.max(1, parseInt(item.quantity) || 1);
      const lineTotal = menu.price * qty;
      foodTotal += lineTotal;
      return { name: menu.name, quantity: qty, unitPrice: menu.price, totalPrice: lineTotal };
    });

    // Tax & fee breakdown
    const subtotal = parseFloat(foodTotal.toFixed(2));
    const taxAmount = parseFloat((subtotal * TAX_RATE).toFixed(2));
    const platformFee = parseFloat((subtotal * PLATFORM_FEE_RATE).toFixed(2));
    const deliveryFeeAmount = 0;
    const restaurantPayout = parseFloat((subtotal - platformFee).toFixed(2));
    const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

    const result = await pool.query(
      `INSERT INTO orders (user_id, restaurant_id, order_number, total_amount, status, theme, guest_count, budget, allergies, avoid_spicy, delivery_time, delivery_address, latitude, longitude, budget_warning_shown, budget_warning_acknowledged, customer_comment, subtotal, tax_rate, tax_amount, platform_fee, delivery_fee_amount, restaurant_payout)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING *`,
      [userId, restaurantId, orderNumber, totalAmount, theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude, budgetWarningShown || false, budgetWarningAcknowledged || false, customerComment || null, subtotal, TAX_RATE, taxAmount, platformFee, deliveryFeeAmount, restaurantPayout]
    );

    const orderId = result.rows[0].id;
    for (const item of resolvedItems) {
      await pool.query(
        'INSERT INTO order_items (order_id, item_name, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)',
        [orderId, item.name, item.quantity, item.unitPrice, item.totalPrice]
      );
    }

    logger.info({ orderId }, 'Order created');
    return result.rows[0];
  } catch (error) {
    logger.error({ error: error.message }, 'Create order failed');
    throw error;
  }
};

// Get Order By Id
const getOrderById = async (orderId) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (result.rows.length === 0) throw new Error('Order not found');
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
    return { ...result.rows[0], items: itemsResult.rows };
  } catch (error) {
    logger.error({ error: error.message }, 'Get order failed');
    throw error;
  }
};

// Get User Orders
const getUserOrders = async (userId) => {
  try {
    const result = await pool.query(`SELECT o.*, r.name as restaurant_name, r.phone as restaurant_phone FROM orders o LEFT JOIN restaurants r ON o.restaurant_id = r.id WHERE o.user_id = $1 ORDER BY o.created_at DESC`, [userId]);
    const orders = result.rows;

    // ดึง order_items ของทุก order ในครั้งเดียว (แก้ N+1)
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length > 0) {
      const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = ANY($1)', [orderIds]);
      const itemsByOrder = {};
      for (const item of itemsResult.rows) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push(item);
      }
      for (const order of orders) {
        order.order_items = itemsByOrder[order.id] || [];
      }
    }

    return orders;
  } catch (error) {
    logger.error({ error: error.message }, 'Get user orders failed');
    throw error;
  }
};

// Update Order Status
const updateOrderStatus = async (orderId, status) => {
  try {
    const result = await pool.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, orderId]
    );
    if (result.rows.length === 0) throw new Error('Order not found');
    logger.info({ orderId, status }, 'Order status updated');
    return result.rows[0];
  } catch (error) {
    logger.error({ error: error.message }, 'Update order status failed');
    throw error;
  }
};

// Get Restaurant Orders
const getRestaurantOrders = async (restaurantId) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE restaurant_id = $1 ORDER BY created_at DESC', [restaurantId]);
    return result.rows;
  } catch (error) {
    logger.error({ error: error.message }, 'Get restaurant orders failed');
    throw error;
  }
};

// Submit rating & review (เฉพาะ order ที่ delivered แล้ว)
const submitRating = async (orderId, rating, review) => {
  try {
    const result = await pool.query(
      'UPDATE orders SET rating = $1, review = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [rating, review || null, orderId]
    );
    if (result.rows.length === 0) throw new Error('Order not found');
    return result.rows[0];
  } catch (error) {
    logger.error({ error: error.message }, 'Submit rating failed');
    throw error;
  }
};

// ============================================================
// Table Home (Phase 3 / Feature 2 & 3) — Members, open ordering
// with per-item attribution, and Party Activities.
//
// Auth model for these: any authenticated BillTable user who knows the
// numeric orderId can join/add — there is no real "invited member" check
// yet (that's Phase 8, QR + Passcode invite). Good enough for one table
// of people who all have the app link; not a hard access-control boundary.
// ============================================================

// Recompute subtotal/tax/platform fee/total from the current order_items
// rows. Called any time items are added or removed so total_amount never
// drifts out of sync.
const recalculateOrderTotals = async (orderId) => {
  const orderResult = await pool.query('SELECT tax_rate FROM orders WHERE id = $1', [orderId]);
  if (orderResult.rows.length === 0) throw new Error('Order not found');
  const taxRate = parseFloat(orderResult.rows[0].tax_rate) || 0.0875;
  const PLATFORM_FEE_RATE = 0.10;

  const itemsResult = await pool.query(
    'SELECT COALESCE(SUM(total_price), 0) as subtotal FROM order_items WHERE order_id = $1',
    [orderId]
  );
  const subtotal = parseFloat(itemsResult.rows[0].subtotal) || 0;
  const taxAmount = parseFloat((subtotal * taxRate).toFixed(2));
  const platformFee = parseFloat((subtotal * PLATFORM_FEE_RATE).toFixed(2));
  const restaurantPayout = parseFloat((subtotal - platformFee).toFixed(2));
  const totalAmount = parseFloat((subtotal + taxAmount).toFixed(2));

  const result = await pool.query(
    `UPDATE orders SET subtotal = $1, tax_amount = $2, platform_fee = $3, restaurant_payout = $4, total_amount = $5, updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [subtotal, taxAmount, platformFee, restaurantPayout, totalAmount, orderId]
  );
  return result.rows[0];
};

// "Table view" — a safe, ownership-unrestricted read of an order for
// anyone at the table (QR-invited guests included), used by Table Home.
// Deliberately separate from getOrderById, which stays IDOR-protected for
// the order owner's own screens (OrderHistory / OrderTracking / rating).
const getTableView = async (orderId) => {
  const result = await pool.query(
    `SELECT o.*, r.name as restaurant_name, r.address as restaurant_address
     FROM orders o LEFT JOIN restaurants r ON o.restaurant_id = r.id
     WHERE o.id = $1`,
    [orderId]
  );
  if (result.rows.length === 0) throw new Error('Order not found');
  const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
  return { ...result.rows[0], items: itemsResult.rows };
};

// Roster
const getOrderMembers = async (orderId) => {
  const result = await pool.query('SELECT * FROM order_members WHERE order_id = $1 ORDER BY created_at ASC', [orderId]);
  return result.rows;
};

// role is always stored as 'guest' — who's "host" is decided by the
// frontend from join order (first row = host), not by what a joiner
// claims to be, since anyone can call this endpoint.
const addOrderMember = async (orderId, name) => {
  const existing = await pool.query(
    'SELECT * FROM order_members WHERE order_id = $1 AND LOWER(name) = LOWER($2)',
    [orderId, name]
  );
  if (existing.rows.length > 0) return existing.rows[0];
  const result = await pool.query(
    'INSERT INTO order_members (order_id, name, role) VALUES ($1, $2, $3) RETURNING *',
    [orderId, name, 'guest']
  );
  return result.rows[0];
};

// Open ordering — any Member can add an item, tagged with their name.
// Price always comes from the menus table for the order's own restaurant,
// never trusted from the client (same rule as createOrder).
const addPartyItem = async (orderId, menuItemId, quantity, addedBy) => {
  const orderResult = await pool.query('SELECT restaurant_id FROM orders WHERE id = $1', [orderId]);
  if (orderResult.rows.length === 0) throw new Error('Order not found');
  const restaurantId = orderResult.rows[0].restaurant_id;

  const menuResult = await pool.query(
    'SELECT id, name, price FROM menus WHERE id = $1 AND restaurant_id = $2 AND is_available = true',
    [menuItemId, restaurantId]
  );
  if (menuResult.rows.length === 0) throw new Error('Menu item is invalid or unavailable for this table');
  const menu = menuResult.rows[0];
  const qty = Math.max(1, parseInt(quantity) || 1);
  const unitPrice = parseFloat(menu.price);
  const totalPrice = parseFloat((unitPrice * qty).toFixed(2));

  const itemResult = await pool.query(
    `INSERT INTO order_items (order_id, item_name, quantity, unit_price, total_price, added_by, menu_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [orderId, menu.name, qty, unitPrice, totalPrice, addedBy, menu.id]
  );

  const order = await recalculateOrderTotals(orderId);
  return { item: itemResult.rows[0], order };
};

// Remove/decrement an item — only the person who added it can remove it
// (soft check on the addedBy name; there's no real per-Member auth yet).
const removePartyItem = async (orderId, itemId, addedBy) => {
  const itemResult = await pool.query('SELECT * FROM order_items WHERE id = $1 AND order_id = $2', [itemId, orderId]);
  if (itemResult.rows.length === 0) throw new Error('Item not found');
  const item = itemResult.rows[0];
  if (addedBy && item.added_by && item.added_by.toLowerCase() !== String(addedBy).toLowerCase()) {
    throw new Error('Only the person who added this item can remove it');
  }

  if (item.quantity > 1) {
    const newQty = item.quantity - 1;
    const newTotal = parseFloat((parseFloat(item.unit_price) * newQty).toFixed(2));
    await pool.query('UPDATE order_items SET quantity = $1, total_price = $2 WHERE id = $3', [newQty, newTotal, itemId]);
  } else {
    await pool.query('DELETE FROM order_items WHERE id = $1', [itemId]);
  }

  const order = await recalculateOrderTotals(orderId);
  return { order };
};

// Activities
const getOrderActivities = async (orderId) => {
  const result = await pool.query('SELECT * FROM order_activities WHERE order_id = $1 ORDER BY created_at ASC', [orderId]);
  return result.rows;
};

const addOrderActivity = async (orderId, title, time, createdBy) => {
  const result = await pool.query(
    'INSERT INTO order_activities (order_id, title, time, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
    [orderId, title, time || null, createdBy || null]
  );
  return result.rows[0];
};

module.exports = {
  createOrder, getOrderById, getUserOrders, updateOrderStatus, getRestaurantOrders, submitRating,
  getTableView, getOrderMembers, addOrderMember, addPartyItem, removePartyItem, getOrderActivities, addOrderActivity,
};
