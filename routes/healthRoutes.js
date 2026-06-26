const express = require('express');
const router = require('express').Router();
const pool = require('../db');
const { sendTrafficAlert } = require('../services/emailService');
const { authenticateToken, requireRole } = require('../middleware/auth');

const alertCooldown = { 70: 0, 90: 0 };
const COOLDOWN_MS = 10 * 60 * 1000;

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

// GET /api/health/traffic — Real-time traffic monitor (Admin only)
router.get('/traffic', authenticateToken, requireRole('admin'), (req, res) => {
  const state = global.trafficState;
  if (!state) {
    return res.status(503).json({ status: 'ERROR', message: 'Traffic monitor not initialized' });
  }

  const matchingPct = Math.round(((state.matchingConcurrent || 0) / (state.matchingThreshold || 49)) * 100);
  const now = Date.now();
  if (matchingPct >= 90 && now - alertCooldown[90] > COOLDOWN_MS) {
    alertCooldown[90] = now;
    sendTrafficAlert({ concurrent: state.matchingConcurrent, threshold: state.matchingThreshold, pct: matchingPct }).catch(() => {});
  } else if (matchingPct >= 70 && now - alertCooldown[70] > COOLDOWN_MS) {
    alertCooldown[70] = now;
    sendTrafficAlert({ concurrent: state.matchingConcurrent, threshold: state.matchingThreshold, pct: matchingPct }).catch(() => {});
  }

  return res.status(200).json({
    concurrent: state.concurrent,
    requestsPerMin: state.requestsLastMinute.length,
    matchingConcurrent: state.matchingConcurrent || 0,
    matchingPerMin: (state.matchingLastMinute || []).length,
    matchingThreshold: state.matchingThreshold || 30,
    matchingPct: Math.round(((state.matchingConcurrent || 0) / (state.matchingThreshold || 30)) * 100),
    isOverLimit: (state.matchingConcurrent || 0) >= (state.matchingThreshold || 30),
    limitEnabled: state.limitEnabled,
  });
});

// POST /api/health/traffic/limit — Enable/Disable limiter (Admin only)
router.post('/traffic/limit', authenticateToken, requireRole('admin'), (req, res) => {
  const state = global.trafficState;
  if (!state) {
    return res.status(503).json({ status: 'ERROR', message: 'Traffic monitor not initialized' });
  }
  const { enabled, threshold } = req.body;
  if (typeof enabled === 'boolean') state.limitEnabled = enabled;
  if (typeof threshold === 'number' && threshold > 0) state.threshold = threshold;
  return res.status(200).json({
    limitEnabled: state.limitEnabled,
    threshold: state.threshold,
    message: state.limitEnabled ? 'Limiter ON — new requests will be blocked when over threshold' : 'Limiter OFF',
  });
});

module.exports = router;
