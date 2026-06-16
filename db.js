require('dotenv').config();
const { Pool } = require('pg');

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