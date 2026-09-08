const pool = require('../db');
const { logger } = require('../middleware/logger');
const { pushToRestaurant } = require('./pushService');

// A party is booked days ahead, so the accept-time alert is long forgotten by
// the time the food is due. Two reminders: one with enough runway to start
// cooking, one last call in case the first was missed.
const WINDOWS = [
  { hours: 4, column: 'reminder_4h_sent', label: 'Delivery in 4 hours' },
  { hours: 1, column: 'reminder_1h_sent', label: 'Delivery in 1 hour' },
];

const DUE_STATUSES = ['accepted', 'preparing'];

const CARD_FIELDS = `id, order_number, status, theme, total_amount, guest_count,
  delivery_time, delivery_address, allergies, avoid_spicy, created_at,
  restaurant_payout, restaurant_id`;

async function runWindow({ hours, column, label }) {
  // delivery_time is stored without a zone and written from UTC ISO strings,
  // and Render runs in UTC, so NOW() is the right thing to compare against.
  const result = await pool.query(
    `SELECT ${CARD_FIELDS}
       FROM orders
      WHERE status = ANY($1)
        AND delivery_time IS NOT NULL
        AND ${column} = FALSE
        AND delivery_time > NOW()
        AND delivery_time <= NOW() + ($2 || ' hours')::interval
      ORDER BY delivery_time ASC
      LIMIT 50`,
    [DUE_STATUSES, String(hours)]
  );

  if (result.rows.length === 0) return 0;

  let sent = 0;
  for (const order of result.rows) {
    try {
      await pushToRestaurant(order.restaurant_id, {
        type: 'reminder',
        title: label,
        body: `${order.order_number} - ${order.guest_count || 0} people`,
        orderId: order.id,
        alertLabel: label,
        order: {
          id: order.id,
          order_number: order.order_number,
          status: order.status,
          theme: order.theme,
          total_amount: order.total_amount,
          guest_count: order.guest_count,
          delivery_time: order.delivery_time,
          delivery_address: order.delivery_address,
          allergies: order.allergies,
          avoid_spicy: order.avoid_spicy,
          created_at: order.created_at,
          restaurant_payout: order.restaurant_payout,
          alertLabel: label,
        },
      });
      sent += 1;
    } catch (e) {
      logger.warn({ orderId: order.id, error: e.message }, 'Reminder push failed');
    }

    // Marked whether or not the push landed: a restaurant with no device
    // registered would otherwise be retried every five minutes forever.
    await pool.query(`UPDATE orders SET ${column} = TRUE WHERE id = $1`, [order.id]);
  }

  logger.info({ hours, found: result.rows.length, sent }, 'Delivery reminders dispatched');
  return sent;
}

async function runDeliveryReminders() {
  try {
    for (const window of WINDOWS) {
      await runWindow(window);
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Delivery reminder sweep failed');
  }
}

module.exports = { runDeliveryReminders };
