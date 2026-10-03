const pool = require('../db');

// Star ratings come from customers after a party (orders.rating / review).
// Summaries are shown on match results so new customers can judge a
// restaurant, and to the restaurant itself.
async function getRatingSummaries(restaurantIds) {
  const ids = (restaurantIds || []).map(Number).filter(Number.isFinite);
  if (ids.length === 0) return {};
  const r = await pool.query(
    `SELECT restaurant_id, ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*)::int AS count
       FROM orders
      WHERE restaurant_id = ANY($1) AND rating IS NOT NULL
      GROUP BY restaurant_id`,
    [ids]
  );
  const out = {};
  for (const row of r.rows) out[row.restaurant_id] = { avg: Number(row.avg), count: row.count };
  return out;
}

async function getRestaurantReviews(restaurantId, limit = 30) {
  const summary = (await getRatingSummaries([restaurantId]))[restaurantId] || { avg: null, count: 0 };
  const r = await pool.query(
    `SELECT id, order_number, rating, review, theme, guest_count, updated_at
       FROM orders
      WHERE restaurant_id = $1 AND rating IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT $2`,
    [restaurantId, limit]
  );
  return { summary, reviews: r.rows };
}

module.exports = { getRatingSummaries, getRestaurantReviews };
