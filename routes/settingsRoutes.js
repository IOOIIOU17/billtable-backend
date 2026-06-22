const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const pool = require('../db');

// GET /api/settings — ดึงค่าทั้งหมด
router.get('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM platform_settings ORDER BY id');
    const settings = {}
    result.rows.forEach(r => { settings[r.key] = r.value })
    res.json({ status: 'OK', data: settings })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: error.message })
  }
});

// PUT /api/settings — อัพเดทค่า
router.put('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const ALLOWED_KEYS = ['commission_rate', 'delivery_fee', 'hidden_fee', 'order_timeout_minutes', 'auto_accept'];
    const PERCENT_KEYS = ['commission_rate', 'delivery_fee', 'hidden_fee'];
    const updates = req.body;

    for (const [key, value] of Object.entries(updates)) {
      // Whitelist key
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ status: 'ERROR', message: `Invalid setting key: ${key}` });
      }
      // Validate percentage range
      if (PERCENT_KEYS.includes(key)) {
        const num = parseFloat(value);
        if (isNaN(num) || num < 0 || num > 100) {
          return res.status(400).json({ status: 'ERROR', message: `${key} must be between 0 and 100` });
        }
      }
    }

    // Get old values for audit log
    const oldResult = await pool.query('SELECT key, value FROM platform_settings WHERE key = ANY($1)', [Object.keys(updates)]);
    const oldValues = {};
    for (const row of oldResult.rows) oldValues[row.key] = row.value;

    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        'UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = $2',
        [String(value), key]
      );
    }

    // Audit log (#36)
    const { auditLog } = require('../middleware/auditLog');
    await auditLog(req.user.userId, 'UPDATE_SETTINGS', { old: oldValues, new: updates });

    res.json({ status: 'OK', message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
