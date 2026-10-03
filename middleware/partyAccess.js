const pool = require('../db');
const { logSecurityEvent } = require('./securityLogger');

// Who may see / act on a party (Table Home, members, food, activities,
// chat). Before this, any logged-in user who knew the order number could
// open any party -- order numbers count up 1, 2, 3, so someone could read
// strangers' addresses, guest names and chat.
//
// Allowed:
//   host        -- the customer who placed the order
//   member      -- joined with the party passcode (order_members.user_id)
//   restaurant  -- owner of the restaurant on the order
//   admin
// Everyone else gets 403 with code PASSCODE_REQUIRED, which the apps use
// to send them to the "enter the passcode" screen.
async function partyAccess(req, res, next) {
  try {
    const orderId = req.params.orderId;
    const userId = req.user?.userId;
    const orderResult = await pool.query('SELECT id, user_id, restaurant_id FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ status: 'ERROR', message: 'Order not found' });
    }
    const order = orderResult.rows[0];
    req.partyOrder = order;

    if (req.user?.role === 'admin') { req.partyRole = 'admin'; return next(); }
    if (Number(order.user_id) === Number(userId)) { req.partyRole = 'host'; return next(); }

    const member = await pool.query(
      'SELECT id FROM order_members WHERE order_id = $1 AND user_id = $2 LIMIT 1',
      [orderId, userId]
    );
    if (member.rows.length > 0) { req.partyRole = 'member'; return next(); }

    const owner = await pool.query(
      'SELECT id FROM restaurants WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
      [order.restaurant_id, userId]
    );
    if (owner.rows.length > 0) { req.partyRole = 'restaurant'; return next(); }

    logSecurityEvent('PARTY_ACCESS_BLOCKED', req, { targetOrderId: orderId });
    return res.status(403).json({
      status: 'ERROR',
      code: 'PASSCODE_REQUIRED',
      message: 'Enter the party passcode to join this table.',
    });
  } catch (error) {
    return res.status(500).json({ status: 'ERROR', message: 'Could not check access to this party.' });
  }
}

function hostOnly(req, res, next) {
  if (req.partyRole === 'host' || req.partyRole === 'admin') return next();
  return res.status(403).json({ status: 'ERROR', message: 'Only the host can do this.' });
}

module.exports = { partyAccess, hostOnly };
