const pool = require('../db');
const { logger } = require('../middleware/logger');

// Every number that touches money is worked out here, from data the database
// already holds. Nothing about price, deposit or refund is ever taken from the
// client — same rule createOrder() follows for menu prices.

const SETTING_DEFAULTS = {
  commission_rate: 10,
  dinein_free_cancel_days: 7,
  dinein_forfeit_hours: 72,
  dinein_reschedule_hours: 72,
  dinein_autocomplete_hours: 24,
  dinein_agreement_version: 'v1.0',
};

const getSettings = async () => {
  const keys = Object.keys(SETTING_DEFAULTS);
  const result = await pool.query(
    'SELECT key, value FROM platform_settings WHERE key = ANY($1)',
    [keys]
  );
  const settings = { ...SETTING_DEFAULTS };
  for (const row of result.rows) {
    const fallback = SETTING_DEFAULTS[row.key];
    settings[row.key] =
      typeof fallback === 'number' ? Number(row.value) : row.value;
  }
  return settings;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// What the booking costs and how the deposit splits.
// bookingTotal   = the restaurant's own per-head price x party size
// platformCut    = commission_rate% of bookingTotal, taken once, never revisited
// restaurantHold = the rest of the deposit, paid out when the party is done
const quoteBooking = async (packageId, partySize) => {
  const size = Number(partySize);
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Party size must be a whole number of guests');
  }

  const result = await pool.query(
    `SELECT p.id, p.name, p.price_per_person, p.min_guests, p.max_guests, p.is_active,
            r.id AS restaurant_id, r.name AS restaurant_name,
            r.deposit_percent, r.max_party_size, r.accepts_dinein,
            r.is_active AS restaurant_open, r.is_deleted
       FROM dinein_packages p
       JOIN restaurants r ON r.id = p.restaurant_id
      WHERE p.id = $1`,
    [packageId]
  );
  if (result.rows.length === 0) throw new Error('That package no longer exists');

  const pkg = result.rows[0];
  if (!pkg.is_active) throw new Error('That package is no longer offered');
  if (pkg.is_deleted || !pkg.restaurant_open) throw new Error('That restaurant is closed');
  if (!pkg.accepts_dinein) throw new Error('That restaurant is not taking parties right now');
  if (size < pkg.min_guests) throw new Error(`This package starts at ${pkg.min_guests} guests`);
  if (pkg.max_guests && size > pkg.max_guests) throw new Error(`This package tops out at ${pkg.max_guests} guests`);
  if (pkg.max_party_size && size > pkg.max_party_size) throw new Error(`This restaurant seats up to ${pkg.max_party_size} guests`);

  const settings = await getSettings();
  const pricePerPerson = Number(pkg.price_per_person);
  const depositPercent = Number(pkg.deposit_percent);

  const bookingTotal = round2(pricePerPerson * size);
  const depositAmount = round2(bookingTotal * (depositPercent / 100));
  const platformCut = round2(bookingTotal * (settings.commission_rate / 100));
  const restaurantHold = round2(depositAmount - platformCut);

  if (restaurantHold < 0) {
    // Guarded by the 15% floor on deposit_percent, but never ship money maths
    // that trusts a constraint it does not check.
    throw new Error('Deposit does not cover the service fee for this package');
  }

  return {
    packageId: pkg.id,
    packageName: pkg.name,
    restaurantId: pkg.restaurant_id,
    restaurantName: pkg.restaurant_name,
    partySize: size,
    pricePerPerson,
    bookingTotal,
    depositPercent,
    depositAmount,
    platformCut,
    restaurantHold,
    payAtRestaurant: round2(bookingTotal - depositAmount),
  };
};

// Refund is decided by when the cancellation reaches us, never by the phone's
// clock. reservedAt and "now" both come from the database.
const quoteCancellation = async ({ reservedAt, depositAmount, platformCut, cancelledBy }) => {
  const settings = await getSettings();
  const nowResult = await pool.query('SELECT NOW() AS now');
  const now = nowResult.rows[0].now;

  const hoursUntil = (new Date(reservedAt) - new Date(now)) / 36e5;
  const deposit = Number(depositAmount);
  const cut = Number(platformCut);

  // The restaurant backing out is on the restaurant. The guest gets it all back.
  if (cancelledBy === 'restaurant') {
    return { refundToCustomer: deposit, toRestaurant: 0, toPlatform: 0, hoursUntil, band: 'restaurant_cancelled' };
  }

  if (hoursUntil >= settings.dinein_free_cancel_days * 24) {
    return { refundToCustomer: deposit, toRestaurant: 0, toPlatform: 0, hoursUntil, band: 'free' };
  }
  if (hoursUntil >= settings.dinein_forfeit_hours) {
    return { refundToCustomer: round2(deposit - cut), toRestaurant: 0, toPlatform: cut, hoursUntil, band: 'partial' };
  }
  return { refundToCustomer: 0, toRestaurant: round2(deposit - cut), toPlatform: cut, hoursUntil, band: 'forfeit' };
};

const canReschedule = async (reservedAt, rescheduleCount) => {
  const settings = await getSettings();
  const nowResult = await pool.query('SELECT NOW() AS now');
  const hoursUntil = (new Date(reservedAt) - new Date(nowResult.rows[0].now)) / 36e5;

  if (Number(rescheduleCount) >= 1) {
    return { allowed: false, reason: 'A table can only be moved once', hoursUntil };
  }
  if (hoursUntil < settings.dinein_reschedule_hours) {
    return { allowed: false, reason: `Tables can be moved up to ${settings.dinein_reschedule_hours} hours before`, hoursUntil };
  }
  return { allowed: true, reason: null, hoursUntil };
};

// A confirmed party that came and went and was never closed out by the
// restaurant gets closed here, so money held for them is not stuck forever.
// "Now" and the cutoff are both worked out by the database.
const runPartyAutoComplete = async () => {
  try {
    const settings = await getSettings();
    const due = await pool.query(
      `UPDATE orders
          SET status = 'completed', completed_at = NOW(),
              payout_status = 'released', updated_at = NOW()
        WHERE order_mode = 'dinein'
          AND status = 'confirmed'
          AND reserved_at < NOW() - ($1 || ' hours')::interval
        RETURNING id, restaurant_payout`,
      [String(settings.dinein_autocomplete_hours)]
    );
    if (due.rowCount > 0) {
      logger.info({ closed: due.rowCount }, 'Parties closed out automatically');
    }
    return due.rowCount;
  } catch (error) {
    // A bad row must not kill the interval — log it and try again next run.
    logger.error({ error: error.message }, 'Party auto-complete failed');
    return 0;
  }
};

const AUTO_COMPLETE_EVERY_MS = 30 * 60 * 1000;

module.exports = { getSettings, quoteBooking, quoteCancellation, canReschedule, round2, runPartyAutoComplete, AUTO_COMPLETE_EVERY_MS };
