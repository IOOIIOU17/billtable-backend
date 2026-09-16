const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logger } = require('../middleware/logger');
const { authenticateToken, requireRole } = require('../middleware/auth');
const dinein = require('../services/dineinService');
const { pushToRestaurant, pushToCustomer } = require('../services/pushService');

// Dine-in party booking. Everything here lives on the existing orders table
// with order_mode = 'dinein', so the table chat, members and admin views that
// already key off order_id keep working untouched.

const fail = (res, code, message) => res.status(code).json({ success: false, message });

// The restaurant a signed-in owner actually owns. Never taken from the request.
const ownedRestaurantIds = async (userId) => {
  const r = await pool.query(
    'SELECT id FROM restaurants WHERE owner_user_id = $1 AND is_deleted = false',
    [userId]
  );
  return r.rows.map((row) => row.id);
};

const loadBooking = async (orderId) => {
  const r = await pool.query(
    `SELECT o.*, r.name AS restaurant_name, r.owner_user_id
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.id = $1 AND o.order_mode = 'dinein'`,
    [orderId]
  );
  return r.rows[0] || null;
};

const logAudit = async (user, action, orderId, detail) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_email, user_role, action, resource, resource_id, details)
       VALUES ($1, $2, $3, $4, 'order', $5, $6)`,
      [user.userId, user.email, user.role, action, String(orderId), JSON.stringify(detail)]
    );
  } catch (error) {
    // An audit row must never block the booking itself.
    logger.error({ error: error.message, action, orderId }, 'Dine-in audit log failed');
  }
};

// ─── Packages a guest can book ─────────────────────────────────────────
router.get('/packages/:restaurantId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.name, p.price_per_person, p.min_guests, p.max_guests, p.included_items,
              r.deposit_percent, r.parking_type, r.parking_note, r.max_party_size,
              r.min_advance_hours, r.accepts_dinein
         FROM dinein_packages p
         JOIN restaurants r ON r.id = p.restaurant_id
        WHERE p.restaurant_id = $1 AND p.is_active = TRUE
          AND r.accepts_dinein = TRUE AND r.is_active = TRUE AND r.is_deleted = false
        ORDER BY p.price_per_person`,
      [req.params.restaurantId]
    );
    res.json({ success: true, packages: r.rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to list dine-in packages');
    fail(res, 500, 'Could not load packages');
  }
});

// ─── What a booking would cost, before committing to it ────────────────
router.post('/quote', authenticateToken, async (req, res) => {
  try {
    const { packageId, partySize } = req.body;
    if (!packageId || !partySize) return fail(res, 400, 'Package and party size are required');
    res.json({ success: true, quote: await dinein.quoteBooking(packageId, partySize) });
  } catch (error) {
    fail(res, 400, error.message);
  }
});

// ─── Request a table ───────────────────────────────────────────────────
router.post('/', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { packageId, partySize, reservedAt, theme, neighborhood, allergies, avoidSpicy } = req.body;
    if (!packageId || !partySize || !reservedAt) {
      return fail(res, 400, 'Package, party size and date are required');
    }

    // Prices and deposits come from the database, never from the request body.
    const quote = await dinein.quoteBooking(packageId, partySize);

    const advance = await client.query(
      `SELECT min_advance_hours,
              EXTRACT(EPOCH FROM ($1::timestamptz - NOW())) / 3600 AS hours_until
         FROM restaurants WHERE id = $2`,
      [reservedAt, quote.restaurantId]
    );
    const { min_advance_hours: minHours, hours_until: hoursUntil } = advance.rows[0];
    if (Number(hoursUntil) < 0) return fail(res, 400, 'That date has already passed');
    if (Number(hoursUntil) < Number(minHours)) {
      return fail(res, 400, `This restaurant needs ${minHours} hours notice`);
    }

    await client.query('BEGIN');
    const orderNumber = 'BT-' + Date.now().toString().slice(-6) + Math.random().toString(36).slice(2, 6).toUpperCase();
    const inserted = await client.query(
      `INSERT INTO orders
         (user_id, order_number, restaurant_id, order_mode, status,
          package_id, party_size, guest_count, reserved_at, neighborhood,
          theme, allergies, avoid_spicy,
          booking_total, deposit_percent, deposit_amount,
          platform_fee, restaurant_payout, deposit_status, payout_status,
          total_amount, budget)
       VALUES ($1,$2,$3,'dinein','requested',$4,$5,$5,$6,$7,$8,$9,$10,
               $11,$12,$13,$14,$15,'simulated','pending',$11,$11)
       RETURNING id, order_number, reserved_at`,
      [req.user.userId, orderNumber, quote.restaurantId, packageId, quote.partySize,
       reservedAt, neighborhood || null, theme || null, allergies || null, avoidSpicy === true,
       quote.bookingTotal, quote.depositPercent, quote.depositAmount,
       quote.platformCut, quote.restaurantHold]
    );
    const booking = inserted.rows[0];

    // The host takes the first seat so the table chat has an owner from the start.
    await client.query(
      `INSERT INTO order_members (order_id, user_id, name, role)
       VALUES ($1, $2, $3, 'host')`,
      [booking.id, req.user.userId, req.user.email.split('@')[0]]
    );
    await client.query('COMMIT');

    await logAudit(req.user, 'dinein_requested', booking.id, {
      bookingTotal: quote.bookingTotal, deposit: quote.depositAmount, platformCut: quote.platformCut,
    });

    pushToRestaurant(quote.restaurantId, {
      title: 'New table request',
      body: `${quote.partySize} guests · ${quote.packageName}`,
      data: { type: 'dinein_request', orderId: booking.id },
    }).catch((e) => logger.error({ error: e.message }, 'Dine-in request push failed'));

    res.status(201).json({ success: true, booking, quote });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ error: error.message }, 'Dine-in booking failed');
    fail(res, 400, error.message);
  } finally {
    client.release();
  }
});

// ─── The restaurant's queue ────────────────────────────────────────────
router.get('/restaurant', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const ids = await ownedRestaurantIds(req.user.userId);
    if (ids.length === 0) return res.json({ success: true, bookings: [] });
    const r = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.party_size, o.reserved_at, o.theme,
              o.allergies, o.avoid_spicy, o.booking_total, o.deposit_amount,
              o.restaurant_payout, o.neighborhood, o.created_at,
              u.name AS customer_name, p.name AS package_name
         FROM orders o
         JOIN users u ON u.id = o.user_id
    LEFT JOIN dinein_packages p ON p.id = o.package_id
        WHERE o.order_mode = 'dinein' AND o.restaurant_id = ANY($1)
        ORDER BY o.reserved_at`,
      [ids]
    );
    res.json({ success: true, bookings: r.rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load restaurant party queue');
    fail(res, 500, 'Could not load bookings');
  }
});

// ─── One booking, for whoever is entitled to see it ────────────────────
router.get('/:orderId', authenticateToken, async (req, res) => {
  try {
    const booking = await loadBooking(req.params.orderId);
    if (!booking) return fail(res, 404, 'Booking not found');
    const isHost = booking.user_id === req.user.userId;
    const isOwner = booking.owner_user_id === req.user.userId;
    if (!isHost && !isOwner && req.user.role !== 'admin') return fail(res, 403, 'Not your booking');
    res.json({ success: true, booking, isHost });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load booking');
    fail(res, 500, 'Could not load the booking');
  }
});

module.exports = router;
