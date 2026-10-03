const pool = require('../db');
const { randomPasscode, normalizePasscode } = require('../utils/passcode');

// Host view of the invite: the passcode, generated the first time it is
// asked for (older parties had none).
async function getInvite(orderId) {
  const r = await pool.query('SELECT party_passcode FROM orders WHERE id = $1', [orderId]);
  if (r.rows.length === 0) throw new Error('Order not found');
  let passcode = r.rows[0].party_passcode;
  if (!passcode) {
    passcode = randomPasscode();
    await pool.query('UPDATE orders SET party_passcode = $1 WHERE id = $2 AND party_passcode IS NULL', [passcode, orderId]);
    const again = await pool.query('SELECT party_passcode FROM orders WHERE id = $1', [orderId]);
    passcode = again.rows[0].party_passcode;
  }
  return { passcode };
}

async function setPasscode(orderId, passcode) {
  const clean = String(passcode || '').trim().replace(/\s+/g, ' ');
  if (normalizePasscode(clean).length < 3) throw new Error('Use at least 3 letters or numbers.');
  if (clean.length > 40) throw new Error('Keep it under 40 characters.');
  await pool.query('UPDATE orders SET party_passcode = $1 WHERE id = $2', [clean, orderId]);
  return { passcode: clean };
}

// Guest joins with the passcode. Wrong code -> error, nothing saved.
async function joinParty(orderId, userId, name, passcode) {
  const r = await pool.query('SELECT user_id, party_passcode, status FROM orders WHERE id = $1', [orderId]);
  if (r.rows.length === 0) throw Object.assign(new Error('This table does not exist.'), { statusCode: 404 });
  const order = r.rows[0];
  if (Number(order.user_id) !== Number(userId)) {
    if (!order.party_passcode || normalizePasscode(passcode) !== normalizePasscode(order.party_passcode)) {
      throw Object.assign(new Error('That passcode is not right. Ask the host for it.'), { statusCode: 403 });
    }
  }
  const cleanName = String(name || '').trim().slice(0, 100) || 'Guest';
  const existing = await pool.query('SELECT id FROM order_members WHERE order_id = $1 AND user_id = $2', [orderId, userId]);
  if (existing.rows.length > 0) {
    await pool.query('UPDATE order_members SET name = $1 WHERE id = $2', [cleanName, existing.rows[0].id]);
  } else {
    await pool.query(
      'INSERT INTO order_members (order_id, name, role, user_id) VALUES ($1, $2, $3, $4)',
      [orderId, cleanName, 'guest', userId]
    );
  }
  return { joined: true };
}

// Report: the message is hidden for everyone right away (Apple expects
// objectionable content to be dealt with quickly) and the report is kept
// for BillTable to review.
async function reportMessage(orderId, messageId, reporterId, reason) {
  const m = await pool.query('SELECT id, user_id, sender_name, message FROM order_messages WHERE id = $1 AND order_id = $2', [messageId, orderId]);
  if (m.rows.length === 0) throw Object.assign(new Error('Message not found'), { statusCode: 404 });
  await pool.query(
    'INSERT INTO message_reports (message_id, order_id, reporter_user_id, reason) VALUES ($1, $2, $3, $4)',
    [messageId, orderId, reporterId, String(reason || '').slice(0, 300) || null]
  );
  await pool.query('UPDATE order_messages SET hidden = TRUE WHERE id = $1', [messageId]);
  return m.rows[0];
}

async function blockUser(blockerId, blockedId) {
  if (!blockedId || Number(blockedId) === Number(blockerId)) throw new Error('Cannot block this person.');
  await pool.query(
    'INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [blockerId, blockedId]
  );
  return { blocked: true };
}

module.exports = { getInvite, setPasscode, joinParty, reportMessage, blockUser };
