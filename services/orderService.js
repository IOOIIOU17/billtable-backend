const pool = require('../db');
const { logger } = require('../middleware/logger');

// Generate Order Number
const generateOrderNumber = () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `BT-${year}${month}${day}-${random}`;
};

// Create Order
const createOrder = async (userId, restaurantId, items) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create order
    const orderNumber = generateOrderNumber();
    let totalAmount = 0;

    // Calculate total
    items.forEach(item => {
      totalAmount += item.unit_price * item.quantity;
    });

    const orderResult = await client.query(
      'INSERT INTO orders (user_id, order_number, restaurant_id, total_amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, orderNumber, restaurantId, totalAmount, 'pending']
    );

    const orderId = orderResult.rows[0].id;

    // Add order items
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, item_name, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5)',
        [orderId, item.name, item.quantity, item.unit_price, item.quantity * item.unit_price]
      );
    }

    await client.query('COMMIT');
    logger.info({ orderId, orderNumber }, 'Order created');
    return orderResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error: error.message }, 'Create order failed');
    throw error;
  } finally {
    client.release();
  }
};

// Get Order by ID
const getOrderById = async (orderId, userId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [orderId, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Order not found');
    }

    // Get order items
    const itemsResult = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1',
      [orderId]
    );

    return {
      ...result.rows[0],
      items: itemsResult.rows
    };
  } catch (error) {
    logger.error({ error: error.message }, 'Get order failed');
    throw error;
  }
};

// Get User Orders
const getUserOrders = async (userId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    return result.rows;
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

    if (result.rows.length === 0) {
      throw new Error('Order not found');
    }

    logger.info({ orderId, status }, 'Order status updated');
    return result.rows[0];
  } catch (error) {
    logger.error({ error: error.message }, 'Update order status failed');
    throw error;
  }
};

module.exports = {
  createOrder,
  getOrderById,
  getUserOrders,
  updateOrderStatus
};
