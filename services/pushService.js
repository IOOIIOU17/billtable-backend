const webpush = require('web-push');
const pool = require('../db');
const { logger } = require('../middleware/logger');

let vapidReady = false;
if (process.env.VAPID_EMAIL && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  vapidReady = true;
}

function isExpoToken(raw) {
  return typeof raw === 'string' && raw.indexOf('ExponentPushToken[') !== -1;
}

async function sendExpo(token, payload) {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: payload.title,
      body: payload.body,
      data: { orderId: payload.orderId, type: payload.type },
      sound: 'default',
      priority: 'high',
      channelId: 'orders',
    }),
  });
  const json = await res.json().catch(() => ({}));
  logger.info(
    {
      sentTitle: payload.title,
      sentBody: payload.body,
      tokenTail: String(token).slice(-14),
      expoStatus: res.status,
      expoBody: JSON.stringify(json).slice(0, 300),
    },
    'EXPO PUSH TRACE'
  );
  if (json && json.data && json.data.status === 'error') {
    throw new Error(json.data.message || 'Expo push error');
  }
  return json;
}

async function sendWeb(subscriptionRaw, payload) {
  if (!vapidReady) throw new Error('VAPID keys not configured');
  const subscription = typeof subscriptionRaw === 'string'
    ? JSON.parse(subscriptionRaw)
    : subscriptionRaw;
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

async function dropSubscription(id) {
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
  } catch (e) {
    logger.error({ error: e.message, id }, 'Failed to drop push subscription');
  }
}

async function dispatch(rows, payload, label) {
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (isExpoToken(row.subscription)) {
        await sendExpo(row.subscription.replace(/^"|"$/g, ''), payload);
      } else {
        await sendWeb(row.subscription, payload);
      }
      sent += 1;
    } catch (err) {
      failed += 1;
      const code = err.statusCode;
      if (code === 404 || code === 410) await dropSubscription(row.id);
      logger.warn({ subId: row.id, statusCode: code, error: err.message }, label);
    }
  }
  return { sent, failed, total: rows.length };
}

async function pushToRestaurant(restaurantId, payload) {
  const result = await pool.query(
    `SELECT ps.id, ps.subscription, ps.user_type
       FROM push_subscriptions ps
       JOIN restaurants r ON r.owner_user_id = ps.user_id
      WHERE r.id = $1
        AND ps.user_type IN ('restaurant', 'restaurant_expo')`,
    [restaurantId]
  );
  if (result.rows.length === 0) {
    logger.info({ restaurantId }, 'No push subscription for restaurant');
    return { sent: 0, failed: 0, total: 0 };
  }
  const out = await dispatch(result.rows, payload, 'Restaurant push failed');
  logger.info({ restaurantId, sent: out.sent, failed: out.failed, total: out.total }, 'Restaurant push dispatched');
  return out;
}

async function pushToCustomer(userId, payload) {
  const result = await pool.query(
    `SELECT id, subscription, user_type FROM push_subscriptions
      WHERE user_id = $1 AND user_type IN ('customer', 'customer_expo')`,
    [userId]
  );
  if (result.rows.length === 0) return { sent: 0, failed: 0, total: 0 };
  const out = await dispatch(result.rows, payload, 'Customer push failed');
  logger.info({ userId, sent: out.sent, failed: out.failed, total: out.total }, 'Customer push dispatched');
  return out;
}

async function notifyRestaurantNewOrder(restaurantId, order) {
  const people = order.guest_count ? `${order.guest_count} people` : 'New order';
  const amount = order.total_amount ? `$${order.total_amount}` : '';
  return pushToRestaurant(restaurantId, {
    type: 'new_order',
    title: 'New Order',
    body: `${order.order_number} - ${people} - ${amount}`.trim(),
    orderId: order.id,
  });
}

module.exports = {
  pushToRestaurant,
  pushToCustomer,
  notifyRestaurantNewOrder,
  isExpoToken,
};
