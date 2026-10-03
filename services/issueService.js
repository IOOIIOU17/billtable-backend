const pool = require('../db');

// "Problem with my order" -- the customer tells the restaurant what went
// wrong (missing item, wrong item, late, quality). Without this the only
// way to complain is a card chargeback. The restaurant sees it in its app
// and can reply and/or refund with the existing refund screen.
const ISSUE_TYPES = ['missing_item', 'wrong_item', 'late', 'quality', 'other'];

async function createIssue(orderId, userId, { issueType, message, wantsRefund }) {
  if (!ISSUE_TYPES.includes(issueType)) throw new Error('Pick what went wrong.');
  const r = await pool.query(
    `INSERT INTO order_issues (order_id, user_id, issue_type, message, wants_refund)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [orderId, userId, issueType, message ? String(message).trim().slice(0, 1000) : null, !!wantsRefund]
  );
  return r.rows[0];
}

async function listIssues(orderId) {
  const r = await pool.query('SELECT * FROM order_issues WHERE order_id = $1 ORDER BY created_at DESC', [orderId]);
  return r.rows;
}

async function replyToIssue(orderId, issueId, reply, resolve) {
  const r = await pool.query(
    `UPDATE order_issues
        SET restaurant_reply = COALESCE($1, restaurant_reply),
            status = CASE WHEN $2 THEN 'resolved' ELSE status END,
            resolved_at = CASE WHEN $2 THEN NOW() ELSE resolved_at END
      WHERE id = $3 AND order_id = $4 RETURNING *`,
    [reply ? String(reply).trim().slice(0, 1000) : null, !!resolve, issueId, orderId]
  );
  if (r.rows.length === 0) throw new Error('Issue not found');
  return r.rows[0];
}

module.exports = { ISSUE_TYPES, createIssue, listIssues, replyToIssue };
