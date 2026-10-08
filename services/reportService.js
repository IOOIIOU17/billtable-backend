const pool = require('../db');

// Sales report for a restaurant (for its own accounting / taxes).
// Counts finished orders only: catering 'delivered' and dine-in 'completed'.
// Money columns are the ones written when the order was priced:
// subtotal (food), tax_amount, platform_fee (TigTagTrue 10%), restaurant_payout.
// Month buckets use LA time, since that is where the restaurant does business.
async function getSalesReport(restaurantId) {
  const totals = await pool.query(
    `SELECT
       to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'), 'YYYY-MM') AS month,
       COUNT(*)::int AS orders,
       COALESCE(SUM(subtotal), 0)::numeric(12,2) AS food,
       COALESCE(SUM(tax_amount), 0)::numeric(12,2) AS tax,
       COALESCE(SUM(platform_fee), 0)::numeric(12,2) AS platform_fee,
       COALESCE(SUM(restaurant_payout), 0)::numeric(12,2) AS payout
     FROM orders
     WHERE restaurant_id = $1 AND status IN ('delivered', 'completed')
     GROUP BY 1
     ORDER BY 1 DESC
     LIMIT 24`,
    [restaurantId]
  );
  return { months: totals.rows };
}

async function getSalesCsv(restaurantId) {
  const r = await pool.query(
    `SELECT order_number, status, order_mode,
            to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') AS ordered_at,
            delivery_time, guest_count, subtotal, tax_amount, platform_fee, restaurant_payout, refund_status
       FROM orders
      WHERE restaurant_id = $1 AND status IN ('delivered', 'completed', 'cancelled')
      ORDER BY created_at DESC
      LIMIT 5000`,
    [restaurantId]
  );
  const cols = ['order_number', 'status', 'order_mode', 'ordered_at', 'delivery_time', 'guest_count', 'subtotal', 'tax_amount', 'platform_fee', 'restaurant_payout', 'refund_status'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...r.rows.map((row) => cols.map((c) => esc(row[c])).join(','))].join('\n');
}

module.exports = { getSalesReport, getSalesCsv };
