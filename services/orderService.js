const pool = require('../db');
const { logger } = require('../middleware/logger');

// Create Order
const createOrder = async (userId, restaurantId, items, extra = {}) => {
  try {
    const orderNumber = 'BT-' + Date.now().toString().slice(-6) + Math.random().toString(36).slice(2, 6).toUpperCase();
    const totalAmount = items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    const { theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude, budgetWarningShown, budgetWarningAcknowledged } = extra;

    const result = await pool.query(
      `INSERT INTO orders (user_id, restaurant_id, order_number, total_amount, status, theme, guest_count, budget, allergies, avoid_spicy, delivery_time, delivery_address, latitude, longitude, budget_warning_shown, budget_warning_acknowledged)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [userId, restaurantId, orderNumber, totalAmount, theme, guestCount, budget, allergies, avoidSpicy, deliveryTime, deliveryAddress, latitude, longitude, budgetWarningShown || false, budgetWarningAcknowledged || false]
    );

    const orderId = result.rows[0].id;
    for (const item of items) {
      await pool.query(
        'INSERT INTO order_items (order_id, item_name, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)',
        [orderId, item.name, item.quantity, item.unitPrice, item.unitPrice * item.quantity]
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
    const result = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
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
