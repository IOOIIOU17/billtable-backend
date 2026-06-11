const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/health
router.get('/', async (req, res) => {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    const dbMs = Date.now() - start;
    return res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      database: { status: 'connected', response_ms: dbMs },
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      database: { status: 'disconnected', error: error.message }
    });
  }
});

module.exports = router;
