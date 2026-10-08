const express = require('express');
const { geocodeAddress } = require('../utils/geocode');
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
    const { address, building, phone } = req.body;
    let { latitude, longitude } = req.body;
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ status: 'ERROR', message: 'Please enter a delivery address.' });
    }
    // Typed address with no map pin: find its coordinates here (utils/geocode).
    if (latitude == null || longitude == null) {
      const hit = await geocodeAddress(address);
      if (!hit) {
        return res.status(400).json({ status: 'ERROR', message: "We couldn't find that address. Check the street number and city, or tap \"Use my location\"." });
      }
      ({ latitude, longitude } = hit);
    }
    latitude = Number(latitude);
    longitude = Number(longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return res.status(400).json({ status: 'ERROR', message: 'That location looks wrong. Please try again.' });
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
