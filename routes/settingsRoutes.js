const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const pool = require('../db');

// GET /api/settings — ดึงค่าทั้งหมด
router.get('/', authenticateToken, async (req, res) => {
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
router.put('/', authenticateToken, async (req, res) => {
  try {
    const updates = req.body
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        'UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = $2',
        [String(value), key]
      )
    }
    res.json({ status: 'OK', message: 'Settings updated' })
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: error.message })
  }
});

module.exports = router;
