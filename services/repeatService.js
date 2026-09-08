const pool = require('../db');
const { logger } = require('../middleware/logger');
const { pushToRestaurant } = require('./pushService');

// A phone face-down on a counter gets one chime and then silence. Real kitchens
// miss that, so an unanswered order keeps ringing the way a phone call does,
// until someone accepts it or the window runs out.
const RETRY_EVERY_MS = 30 * 1000;
const GIVE_UP_AFTER_MINUTES = 5;

const CARD_FIELDS = `id, order_number, status, theme, total_amount, guest_count,
  delivery_time, delivery_address, allergies, avoid_spicy, created_at,
  restaurant_payout, restaurant_id`;

async function runUnansweredSweep() {
  try {
    const result = await pool.query(
      `SELECT ${CARD_FIELDS},
              (SELECT COUNT(*) FROM orders o2
                WHERE o2.restaurant_id = orders.restaurant_id
                  AND o2.status = 'pending') AS pending_count
         FROM orders
        WHERE status = 'pending'
          AND created_at > NOW() - ($1 || ' minutes')::interval
        ORDER BY created_at ASC
        LIMIT 30`,
      [String(GIVE_UP_AFTER_MINUTES)]
    );

    if (result.rows.length === 0) return;

    for (const order of result.rows) {
      try {
        await pushToRestaurant(order.restaurant_id, {
          type: 'new_order',
          title: 'Still waiting',
          body: `${order.order_number} - ${order.guest_count || 0} people`,
          orderId: order.id,
          // The badge is what the owner sees from the home screen without
          // unlocking anything.
          badge: Number(order.pending_count) || 1,
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
          },
        });
      } catch (e) {
        logger.warn({ orderId: order.id, error: e.message }, 'Retry push failed');
      }
    }

    logger.info({ count: result.rows.length }, 'Unanswered orders re-alerted');
  } catch (error) {
    logger.error({ error: error.message }, 'Unanswered sweep failed');
  }
}

module.exports = { runUnansweredSweep, RETRY_EVERY_MS };
