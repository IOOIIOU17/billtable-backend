require('dotenv').config();
const { Pool, types } = require('pg');

// delivery_time / created_at / updated_at are all `timestamp without time
// zone` — naive wall-clock values with no zone info, written by the client
// apps as local time (e.g. "2026-09-25 18:30:00", built from getHours()/
// getMonth() etc., not UTC). pg's default parser (OID 1114) converts that
// into a JS Date using the SERVER process's timezone, which silently
// shifts it whenever the server isn't in the same zone the value was
// written in — Render runs in UTC, TigTagTrue is LA-only, so every naive
// timestamp read back was off by the UTC/Pacific offset. Returning the raw
// string instead lets each client's own `new Date(str)` interpret it as
// its own local time, which is what was actually intended — no client
// code needs to change for this to be correct.
types.setTypeParser(1114, (str) => str);

// Pool sizing: Render Postgres Basic-256mb (0.5 CPU) handles limited
// concurrent connections. 12 is a safe starting point for Phase 11 load testing.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 12,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Lightweight connection usage logging for load testing visibility.
// Logs only when pool usage is non-trivial, to avoid noisy logs in normal traffic.
setInterval(() => {
  const { totalCount, idleCount, waitingCount } = pool;
  if (totalCount > 0) {
    console.log(`[DB POOL] total=${totalCount} idle=${idleCount} waiting=${waitingCount}`);
  }
}, 5000);

module.exports = pool;