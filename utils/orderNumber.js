// utils/orderNumber.js
// Order numbers in invoice style: TT-2026-000001 (brand, LA year, running
// number). The counter restarts each year and never repeats or skips inside
// a year when called inside the order's own transaction, so the accountant
// (and CDTFA) can see every order of the year in sequence. Tony chose this
// on 9 Oct 2026; orders before that keep their old BT-… numbers.
const pool = require('../db');

function laYear(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric' }).format(date));
}

// db: a pg client inside a transaction (preferred) or the pool.
async function nextOrderNumber(db = pool) {
  const year = laYear();
  const r = await db.query(
    `INSERT INTO order_number_counters (year, last_value) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_value = order_number_counters.last_value + 1
     RETURNING last_value`,
    [year]
  );
  return `TT-${year}-${String(r.rows[0].last_value).padStart(6, '0')}`;
}

module.exports = { nextOrderNumber, laYear };
