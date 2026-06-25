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
    const DELIVERY_FEE = 40;
    const SERVICE_FEE = 40;
    const TAX_RATE = extra.taxRate || 0.0875; // Default 8.75% (CA) — overridable per ZIP later
    const PLATFORM_FEE_RATE = 0.10; // 10% platform commission
    const DELIVERY_FEE_RATE = 0.05; // 5% delivery fee (charged to restaurant)

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
    const deliveryFeeAmount = parseFloat((subtotal * DELIVERY_FEE_RATE).toFixed(2));
    const restaurantPayout = parseFloat((subtotal - platformFee - deliveryFeeAmount).toFixed(2));
    const totalAmount = parseFloat((subtotal + taxAmount + DELIVERY_FEE + SERVICE_FEE).toFixed(2));

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

module.exports = { createOrder, getOrderById, getUserOrders, updateOrderStatus, getRestaurantOrders, submitRating };
