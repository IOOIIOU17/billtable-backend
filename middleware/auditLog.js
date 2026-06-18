const pool = require('../db');
const { logger } = require('./logger');

async function auditLog(userId, userEmail, userRole, action, resource, resourceId, ipAddress, details) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_email, user_role, action, resource, resource_id, ip_address, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId || null, userEmail || null, userRole || null, action, resource || null, resourceId || null, ipAddress || null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    logger.error({ error: err.message }, 'Audit log write failed');
  }
}

module.exports = { auditLog };
