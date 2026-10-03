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
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '008_party_access_and_moderation.sql'), 'utf8');
    await pool.query(sql);
    logger.info('Party access / moderation schema ready (migration 008)');
  } catch (error) {
    logger.error({ error: error.message }, 'Migration 008 failed');
  }
}

module.exports = { ensurePartySchema };
