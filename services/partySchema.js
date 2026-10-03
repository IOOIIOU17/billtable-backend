const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { logger } = require('../middleware/logger');

// Runs migration 008 once at server start. Every statement in it is
// IF NOT EXISTS, so this is safe on every deploy and needs no manual
// psql step. A failure is logged, never fatal: the rest of the API keeps
// running and the party endpoints report the problem on their own.
async function ensurePartySchema() {
  try {
    // Idempotent migrations applied on every boot (each is IF NOT EXISTS).
    for (const file of ['008_party_access_and_moderation.sql', '009_order_issues.sql', '010_restaurant_capacity.sql', '011_extras_onway_birthdays.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
      await pool.query(sql);
      logger.info(`Migration ready: ${file}`);
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Startup migration failed');
  }
}

module.exports = { ensurePartySchema };
