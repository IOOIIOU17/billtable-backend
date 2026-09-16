const express = require('express');
const router = express.Router();
const pool = require('../db');
const { logger } = require('../middleware/logger');
const { authenticateToken, requireRole } = require('../middleware/auth');
const dinein = require('../services/dineinService');
const { pushToRestaurant, pushToCustomer } = require('../services/pushService');
const { addOrderMessage } = require('../services/orderService');

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

// orders.refund_status only accepts none | partial | full, so map the split onto it.
const refundStatusFor = (split, deposit) => {
  if (Number(split.refundToCustomer) <= 0) return 'none';
  if (Number(split.refundToCustomer) >= Number(deposit)) return 'full';
  return 'partial';
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

// ─── Restaurant side: switches, venue details and packages ─────────────
// Everything here works on the restaurant the signed-in owner actually owns.
// The id is looked up from owner_user_id, never taken from the request.

const myRestaurant = async (userId) => {
  const r = await pool.query(
    `SELECT id, name, is_active, accepts_delivery, accepts_dinein, deposit_percent,
            parking_type, parking_note, max_party_size, min_advance_hours
       FROM restaurants
      WHERE owner_user_id = $1 AND is_deleted = false
      ORDER BY id LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
};

router.get('/settings/mine', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const restaurant = await myRestaurant(req.user.userId);
    if (!restaurant) return fail(res, 404, 'No restaurant on this account');

    const packages = await pool.query(
      `SELECT id, name, price_per_person, min_guests, max_guests, included_items, is_active
         FROM dinein_packages WHERE restaurant_id = $1 ORDER BY id`,
      [restaurant.id]
    );
    res.json({ success: true, restaurant, packages: packages.rows });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to load dine-in settings');
    fail(res, 500, 'Could not load your settings');
  }
});

// Open for orders stays the master switch; these two sit under it.
router.patch('/settings/order-types', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const { acceptsDelivery, acceptsDinein } = req.body;
    if (typeof acceptsDelivery !== 'boolean' && typeof acceptsDinein !== 'boolean') {
      return fail(res, 400, 'Nothing to change');
    }

    const restaurant = await myRestaurant(req.user.userId);
    if (!restaurant) return fail(res, 404, 'No restaurant on this account');

    // A restaurant cannot take party bookings with nothing to book.
    if (acceptsDinein === true) {
      const live = await pool.query(
        `SELECT COUNT(*)::int AS n FROM dinein_packages
          WHERE restaurant_id = $1 AND is_active = TRUE`,
        [restaurant.id]
      );
      if (live.rows[0].n === 0) {
        return fail(res, 400, 'Add a party package before you take dine-in bookings');
      }
    }

    const next = {
      delivery: typeof acceptsDelivery === 'boolean' ? acceptsDelivery : restaurant.accepts_delivery,
      dinein: typeof acceptsDinein === 'boolean' ? acceptsDinein : restaurant.accepts_dinein,
    };
    const updated = await pool.query(
      `UPDATE restaurants
          SET accepts_delivery = $2, accepts_dinein = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, accepts_delivery, accepts_dinein, is_active`,
      [restaurant.id, next.delivery, next.dinein]
    );
    await logAudit(req.user, 'restaurant_order_types', restaurant.id, next);
    res.json({ success: true, restaurant: updated.rows[0] });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to change order types');
    fail(res, 500, 'Could not save your switches');
  }
});

router.patch('/settings/venue', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const { depositPercent, parkingType, parkingNote, maxPartySize, minAdvanceHours } = req.body;
    const restaurant = await myRestaurant(req.user.userId);
    if (!restaurant) return fail(res, 404, 'No restaurant on this account');

    // Checked here as well as in the database so the message reads plainly.
    if (depositPercent !== undefined) {
      const pct = Number(depositPercent);
      if (Number.isNaN(pct) || pct < 15 || pct > 50) {
        return fail(res, 400, 'Deposit has to sit between 15% and 50%');
      }
    }
    if (maxPartySize !== undefined && Number(maxPartySize) < 1) {
      return fail(res, 400, 'Max party size has to be at least 1 guest');
    }
    if (minAdvanceHours !== undefined && Number(minAdvanceHours) < 0) {
      return fail(res, 400, 'Notice period cannot be negative');
    }

    const updated = await pool.query(
      `UPDATE restaurants
          SET deposit_percent   = COALESCE($2, deposit_percent),
              parking_type      = COALESCE($3, parking_type),
              parking_note      = COALESCE($4, parking_note),
              max_party_size    = COALESCE($5, max_party_size),
              min_advance_hours = COALESCE($6, min_advance_hours),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, deposit_percent, parking_type, parking_note, max_party_size, min_advance_hours`,
      [restaurant.id,
       depositPercent !== undefined ? depositPercent : null,
       parkingType !== undefined ? parkingType : null,
       parkingNote !== undefined ? parkingNote : null,
       maxPartySize !== undefined ? maxPartySize : null,
       minAdvanceHours !== undefined ? minAdvanceHours : null]
    );
    await logAudit(req.user, 'restaurant_dinein_settings', restaurant.id, updated.rows[0]);
    res.json({ success: true, restaurant: updated.rows[0] });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to save venue settings');
    fail(res, 500, 'Could not save your settings');
  }
});

router.post('/packages', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const { name, pricePerPerson, minGuests, maxGuests, includedItems } = req.body;
    if (!name || !pricePerPerson) return fail(res, 400, 'Name and price per person are required');
    if (Number(pricePerPerson) <= 0) return fail(res, 400, 'Price per person has to be more than zero');

    const restaurant = await myRestaurant(req.user.userId);
    if (!restaurant) return fail(res, 404, 'No restaurant on this account');

    const created = await pool.query(
      `INSERT INTO dinein_packages
         (restaurant_id, name, price_per_person, min_guests, max_guests, included_items)
       VALUES ($1, $2, $3, COALESCE($4, 4), $5, $6)
       RETURNING id, name, price_per_person, min_guests, max_guests, included_items, is_active`,
      [restaurant.id, name, pricePerPerson, minGuests || null, maxGuests || null, includedItems || null]
    );
    await logAudit(req.user, 'dinein_package_created', restaurant.id, created.rows[0]);
    res.status(201).json({ success: true, package: created.rows[0] });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to create package');
    fail(res, 500, 'Could not save the package');
  }
});

router.patch('/packages/:packageId', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const { name, pricePerPerson, minGuests, maxGuests, includedItems, isActive } = req.body;
    const restaurant = await myRestaurant(req.user.userId);
    if (!restaurant) return fail(res, 404, 'No restaurant on this account');

    const owned = await pool.query(
      'SELECT id FROM dinein_packages WHERE id = $1 AND restaurant_id = $2',
      [req.params.packageId, restaurant.id]
    );
    if (owned.rows.length === 0) return fail(res, 404, 'That package is not yours');
    if (pricePerPerson !== undefined && Number(pricePerPerson) <= 0) {
      return fail(res, 400, 'Price per person has to be more than zero');
    }

    const updated = await pool.query(
      `UPDATE dinein_packages
          SET name             = COALESCE($2, name),
              price_per_person = COALESCE($3, price_per_person),
              min_guests       = COALESCE($4, min_guests),
              max_guests       = COALESCE($5, max_guests),
              included_items   = COALESCE($6, included_items),
              is_active        = COALESCE($7, is_active),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, price_per_person, min_guests, max_guests, included_items, is_active`,
      [req.params.packageId,
       name !== undefined ? name : null,
       pricePerPerson !== undefined ? pricePerPerson : null,
       minGuests !== undefined ? minGuests : null,
       maxGuests !== undefined ? maxGuests : null,
       includedItems !== undefined ? includedItems : null,
       typeof isActive === 'boolean' ? isActive : null]
    );

    // Turning off the last package also closes dine-in, so nobody can book
    // a table with nothing behind it.
    let dineinTurnedOff = false;
    if (isActive === false) {
      const live = await pool.query(
        'SELECT COUNT(*)::int AS n FROM dinein_packages WHERE restaurant_id = $1 AND is_active = TRUE',
        [restaurant.id]
      );
      if (live.rows[0].n === 0) {
        await pool.query('UPDATE restaurants SET accepts_dinein = FALSE WHERE id = $1', [restaurant.id]);
        dineinTurnedOff = true;
      }
    }

    await logAudit(req.user, 'dinein_package_updated', restaurant.id, updated.rows[0]);
    res.json({ success: true, package: updated.rows[0], dineinTurnedOff });
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to update package');
    fail(res, 500, 'Could not save the package');
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

// ─── Restaurant confirms the table ─────────────────────────────────────
router.patch('/:orderId/confirm', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const booking = await loadBooking(req.params.orderId);
    if (!booking) return fail(res, 404, 'Booking not found');
    if (booking.owner_user_id !== req.user.userId) return fail(res, 403, 'Not your restaurant');
    if (booking.status !== 'requested') return fail(res, 400, `This booking is already ${booking.status}`);

    await pool.query(
      `UPDATE orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
      [booking.id]
    );
    await logAudit(req.user, 'dinein_confirmed', booking.id, { partySize: booking.party_size });

    addOrderMessage(booking.id, 'BillTable', `${booking.restaurant_name} confirmed your table.`)
      .catch((e) => logger.error({ error: e.message }, 'Confirm chat note failed'));
    pushToCustomer(booking.user_id, {
      title: 'Your table is confirmed',
      body: `${booking.restaurant_name} is expecting ${booking.party_size} of you.`,
      data: { type: 'dinein_confirmed', orderId: booking.id },
    }).catch((e) => logger.error({ error: e.message }, 'Confirm push failed'));

    res.json({ success: true, status: 'confirmed' });
  } catch (error) {
    logger.error({ error: error.message }, 'Confirm booking failed');
    fail(res, 500, 'Could not confirm the booking');
  }
});

// ─── Restaurant turns it down: the guest gets everything back ──────────
router.patch('/:orderId/decline', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const booking = await loadBooking(req.params.orderId);
    if (!booking) return fail(res, 404, 'Booking not found');
    if (booking.owner_user_id !== req.user.userId) return fail(res, 403, 'Not your restaurant');
    if (!['requested', 'confirmed'].includes(booking.status)) {
      return fail(res, 400, `This booking is already ${booking.status}`);
    }

    const split = await dinein.quoteCancellation({
      reservedAt: booking.reserved_at,
      depositAmount: booking.deposit_amount,
      platformCut: booking.platform_fee,
      cancelledBy: 'restaurant',
    });

    await pool.query(
      `UPDATE orders
          SET status = 'declined', cancelled_by = 'restaurant', cancelled_at = NOW(),
              refund_status = 'full', payout_status = 'refunded',
              platform_fee = 0, restaurant_payout = 0, updated_at = NOW()
        WHERE id = $1`,
      [booking.id]
    );
    await logAudit(req.user, 'dinein_declined', booking.id, split);

    addOrderMessage(booking.id, 'BillTable', 'The restaurant could not take this table. Your deposit is being refunded in full.')
      .catch((e) => logger.error({ error: e.message }, 'Decline chat note failed'));
    pushToCustomer(booking.user_id, {
      title: "That table didn't work out",
      body: 'Full refund on the way. Pick another table whenever you like.',
      data: { type: 'dinein_declined', orderId: booking.id },
    }).catch((e) => logger.error({ error: e.message }, 'Decline push failed'));

    res.json({ success: true, status: 'declined', refund: split });
  } catch (error) {
    logger.error({ error: error.message }, 'Decline booking failed');
    fail(res, 500, 'Could not decline the booking');
  }
});

// ─── The host drops the restaurant but keeps the table together ────────
router.post('/:orderId/cancel-table', authenticateToken, async (req, res) => {
  try {
    const booking = await loadBooking(req.params.orderId);
    if (!booking) return fail(res, 404, 'Booking not found');
    if (booking.user_id !== req.user.userId) return fail(res, 403, 'Only the host can cancel this table');
    if (!['requested', 'confirmed'].includes(booking.status)) {
      return fail(res, 400, `This booking is already ${booking.status}`);
    }

    const split = await dinein.quoteCancellation({
      reservedAt: booking.reserved_at,
      depositAmount: booking.deposit_amount,
      platformCut: booking.platform_fee,
      cancelledBy: 'customer',
    });

    await pool.query(
      `UPDATE orders
          SET status = 'cancelled', cancelled_by = 'customer', cancelled_at = NOW(),
              refund_status = $2, payout_status = $3,
              platform_fee = $4, restaurant_payout = $5, updated_at = NOW()
        WHERE id = $1`,
      [booking.id, refundStatusFor(split, booking.deposit_amount),
       split.toRestaurant > 0 ? 'released' : 'forfeited', split.toPlatform, split.toRestaurant]
    );
    await logAudit(req.user, 'dinein_cancel_table', booking.id, split);

    addOrderMessage(booking.id, 'BillTable', `The booking at ${booking.restaurant_name} is off. This table is still open — pick another place.`)
      .catch((e) => logger.error({ error: e.message }, 'Cancel-table chat note failed'));
    pushToRestaurant(booking.restaurant_id, {
      title: 'Table cancelled',
      body: `${booking.party_size} guests · ${new Date(booking.reserved_at).toDateString()}`,
      data: { type: 'dinein_cancelled', orderId: booking.id },
    }).catch((e) => logger.error({ error: e.message }, 'Cancel-table push failed'));

    res.json({ success: true, status: 'cancelled', tableStillOpen: true, refund: split });
  } catch (error) {
    logger.error({ error: error.message }, 'Cancel table failed');
    fail(res, 500, 'Could not cancel the booking');
  }
});

// ─── The host calls the whole party off and closes the table ───────────
router.post('/:orderId/cancel-party', authenticateToken, async (req, res) => {
  try {
    const booking = await loadBooking(req.params.orderId);
    if (!booking) return fail(res, 404, 'Booking not found');
    if (booking.user_id !== req.user.userId) return fail(res, 403, 'Only the host can cancel this party');
    if (['completed', 'cancelled', 'declined'].includes(booking.status)) {
      return fail(res, 400, `This party is already ${booking.status}`);
    }

    const split = await dinein.quoteCancellation({
      reservedAt: booking.reserved_at,
      depositAmount: booking.deposit_amount,
      platformCut: booking.platform_fee,
      cancelledBy: 'customer',
    });

    await pool.query(
      `UPDATE orders
          SET status = 'cancelled', cancelled_by = 'customer', cancelled_at = NOW(),
              table_closed_at = NOW(), refund_status = $2, payout_status = $3,
              platform_fee = $4, restaurant_payout = $5, updated_at = NOW()
        WHERE id = $1`,
      [booking.id, refundStatusFor(split, booking.deposit_amount),
       split.toRestaurant > 0 ? 'released' : 'forfeited', split.toPlatform, split.toRestaurant]
    );
    await logAudit(req.user, 'dinein_cancel_party', booking.id, split);

    addOrderMessage(booking.id, 'BillTable', 'The host called this party off. The table is closed.')
      .catch((e) => logger.error({ error: e.message }, 'Cancel-party chat note failed'));
    pushToRestaurant(booking.restaurant_id, {
      title: 'Party cancelled',
      body: `${booking.party_size} guests · ${new Date(booking.reserved_at).toDateString()}`,
      data: { type: 'dinein_cancelled', orderId: booking.id },
    }).catch((e) => logger.error({ error: e.message }, 'Cancel-party push failed'));

    res.json({ success: true, status: 'cancelled', tableClosed: true, refund: split });
  } catch (error) {
    logger.error({ error: error.message }, 'Cancel party failed');
    fail(res, 500, 'Could not cancel the party');
  }
});

// ─── Move the table to another day: free once, 72 hours out ────────────
router.post('/:orderId/reschedule', authenticateToken, async (req, res) => {
  try {
    const { reservedAt } = req.body;
    if (!reservedAt) return fail(res, 400, 'A new date is required');

    const booking = await loadBooking(req.params.orderId);
    if (!booking) return fail(res, 404, 'Booking not found');
    if (booking.user_id !== req.user.userId) return fail(res, 403, 'Only the host can move this table');
    if (!['requested', 'confirmed'].includes(booking.status)) {
      return fail(res, 400, `This booking is already ${booking.status}`);
    }

    const check = await dinein.canReschedule(booking.reserved_at, booking.reschedule_count);
    if (!check.allowed) return fail(res, 400, check.reason);

    const ahead = await pool.query(
      `SELECT EXTRACT(EPOCH FROM ($1::timestamptz - NOW())) / 3600 AS hours_until,
              (SELECT min_advance_hours FROM restaurants WHERE id = $2) AS min_hours`,
      [reservedAt, booking.restaurant_id]
    );
    const { hours_until: hoursUntil, min_hours: minHours } = ahead.rows[0];
    if (Number(hoursUntil) < Number(minHours)) {
      return fail(res, 400, `The new date needs ${minHours} hours notice`);
    }

    // Back to 'requested': the restaurant has to agree to the new day too.
    await pool.query(
      `UPDATE orders
          SET reserved_at = $2, status = 'requested',
              reschedule_count = reschedule_count + 1, updated_at = NOW()
        WHERE id = $1`,
      [booking.id, reservedAt]
    );
    await logAudit(req.user, 'dinein_rescheduled', booking.id, { from: booking.reserved_at, to: reservedAt });

    addOrderMessage(booking.id, 'BillTable', 'The host asked to move this table. Waiting on the restaurant.')
      .catch((e) => logger.error({ error: e.message }, 'Reschedule chat note failed'));
    pushToRestaurant(booking.restaurant_id, {
      title: 'Guest asked to move a table',
      body: `${booking.party_size} guests · ${new Date(reservedAt).toDateString()}`,
      data: { type: 'dinein_reschedule', orderId: booking.id },
    }).catch((e) => logger.error({ error: e.message }, 'Reschedule push failed'));

    res.json({ success: true, status: 'requested', reservedAt });
  } catch (error) {
    logger.error({ error: error.message }, 'Reschedule failed');
    fail(res, 500, 'Could not move the table');
  }
});

// ─── The party happened: release what is held for the restaurant ───────
router.patch('/:orderId/complete', authenticateToken, requireRole('restaurant'), async (req, res) => {
  try {
    const booking = await loadBooking(req.params.orderId);
    if (!booking) return fail(res, 404, 'Booking not found');
    if (booking.owner_user_id !== req.user.userId) return fail(res, 403, 'Not your restaurant');
    if (booking.status !== 'confirmed') return fail(res, 400, `This booking is ${booking.status}, not confirmed`);

    // A party cannot be over before it starts. The database decides "now".
    const when = await pool.query(
      `SELECT NOW() >= reserved_at AS has_started FROM orders WHERE id = $1`,
      [booking.id]
    );
    if (!when.rows[0].has_started) return fail(res, 400, 'This party has not happened yet');

    await pool.query(
      `UPDATE orders
          SET status = 'completed', completed_at = NOW(),
              payout_status = 'released', updated_at = NOW()
        WHERE id = $1`,
      [booking.id]
    );
    await logAudit(req.user, 'dinein_completed', booking.id, { payout: booking.restaurant_payout });

    pushToCustomer(booking.user_id, {
      title: 'Hope it was a good one',
      body: `Thanks for taking a table at ${booking.restaurant_name}.`,
      data: { type: 'dinein_completed', orderId: booking.id },
    }).catch((e) => logger.error({ error: e.message }, 'Complete push failed'));

    res.json({ success: true, status: 'completed', payout: booking.restaurant_payout });
  } catch (error) {
    logger.error({ error: error.message }, 'Complete booking failed');
    fail(res, 500, 'Could not close the booking');
  }
});

module.exports = router;
