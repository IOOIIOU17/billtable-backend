const express = require('express');
const { generalLimiter } = require('../middleware/rateLimit');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const pool = require('../db');

// GET /api/addresses - ดึงที่อยู่ล่าสุดของ user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM delivery_addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.userId]
    );
    return res.status(200).json({ status: 'OK', address: result.rows[0] || null });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/addresses - เพิ่มที่อยู่ใหม่
router.post('/', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const { address, building, phone, latitude, longitude } = req.body;
    if (!address || latitude == null || longitude == null) {
      return res.status(400).json({ status: 'ERROR', message: 'address, latitude, longitude are required' });
    }
    const result = await pool.query(
      `INSERT INTO delivery_addresses (user_id, address, building, phone, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.userId, address, building || '', phone || '', latitude, longitude]
    );
    return res.status(201).json({ status: 'OK', address: result.rows[0] });
  } catch (error) {
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

module.exports = router;
