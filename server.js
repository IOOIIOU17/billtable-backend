require('./instrument.js');
const Sentry = require('@sentry/node');

/**
 * ============================================================
 * BillTable Backend Server
 * ============================================================
 * Express server entry point.
 *
 * Mounts all routes, middleware, health check, and handlers.
 * Run with: node server.js
 *
 * Updated: Phase 4 (added restaurant + menu + matching routes)
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const pool = require('./db');
const config = require('./config/env');
const { helmetMiddleware, corsMiddleware, limiter } = require('./middleware/security');
const { logger, requestLogger } = require('./middleware/logger');

// Route modules
const authRoutes = require('./routes/authRoutes');
const orderRoutes = require('./routes/orderRoutes');
const restaurantRoutes = require('./routes/restaurantRoutes');
const menuRoutes = require('./routes/menuRoutes');
const matchingRoutes = require('./routes/matchingRoutes');
const userRoutes = require('./routes/userRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const healthRoutes = require('./routes/healthRoutes');
const addressRoutes = require('./routes/addressRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

// Backup
const { runBackup } = require('./utils/backup');
setInterval(runBackup, 24 * 60 * 60 * 1000);



// ============================================================
// Traffic Monitor State (Real-time)
// ============================================================
const trafficState = {
  concurrent: 0,
  requestsLastMinute: [],
  matchingConcurrent: 0,
  matchingLastMinute: [],
  matchingThreshold: 49,
  limitEnabled: false,
};

// Export ให้ healthRoutes ดึงไปใช้
global.trafficState = trafficState;

// Traffic Alert Monitor — เช็คทุก 1 วินาที ไม่ต้องรอให้ Admin เปิดหน้า
const { sendTrafficAlert } = require('./services/emailService');
const alertCooldown = { 70: 0, 90: 0 };
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

setInterval(() => {
  const state = global.trafficState;
  if (!state) return;
  const pct = Math.round((state.matchingConcurrent / (state.matchingThreshold || 49)) * 100);
  const now = Date.now();
  if (pct > 0) console.log(`[TRAFFIC] matching=${state.matchingConcurrent} pct=${pct}%`);
  if (pct >= 90 && now - alertCooldown[90] > ALERT_COOLDOWN_MS) {
    alertCooldown[90] = now;
    alertCooldown[70] = now;
    console.log('[ALERT] Sending 90% alert email');
    sendTrafficAlert({ concurrent: state.matchingConcurrent, threshold: state.matchingThreshold, pct }).then(() => console.log('[ALERT] Email sent OK')).catch(e => console.log('[ALERT] Email error:', e.message));
  } else if (pct >= 70 && now - alertCooldown[70] > ALERT_COOLDOWN_MS) {
    alertCooldown[70] = now;
    console.log('[ALERT] Sending 70% alert email');
    sendTrafficAlert({ concurrent: state.matchingConcurrent, threshold: state.matchingThreshold, pct }).then(() => console.log('[ALERT] Email sent OK')).catch(e => console.log('[ALERT] Email error:', e.message));
  }
}, 1000);

const app = express();

// Trust Render's reverse proxy so req.ip = real client IP
// (จำเป็นมาก สำหรับ rate limiter ให้แยกตามคนจริง ไม่ใช่รวมทุกคนเป็น IP เดียว)
app.set('trust proxy', 1);

// ============================================================
// Security & Logging Middleware
// ============================================================
app.use(helmetMiddleware);

// ============================================================
// Traffic Counter Middleware
// ============================================================
app.use((req, res, next) => {
  // ถ้า Limiter เปิดอยู่ และ concurrent เกิน threshold → block
  if (trafficState.limitEnabled && trafficState.concurrent >= trafficState.threshold) {
    return res.status(503).json({
      status: 'ERROR',
      message: 'System is currently at capacity. Please try again shortly.',
    });
  }

  trafficState.concurrent++;
  const now = Date.now();
  trafficState.requestsLastMinute.push(now);

  // เคลียร์ request ที่เก่ากว่า 1 นาที
  trafficState.requestsLastMinute = trafficState.requestsLastMinute.filter(
    t => now - t < 60 * 1000
  );

  res.on('finish', () => {
    trafficState.concurrent = Math.max(0, trafficState.concurrent - 1);
  });

  next();
});
app.use(corsMiddleware);
app.use(limiter);
app.use(requestLogger);

// ============================================================
// Body Parser
// ============================================================
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook') {
    next();
  } else {
    express.json({ limit: '10kb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ============================================================
// API Routes
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/menus', menuRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentRoutes);

// ============================================================
// Health Check Endpoint
// ============================================================
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.info('Health check passed');
    res.json({
      status: 'OK',
      message: 'BillTable Backend is running!',
      database: 'Connected',
      timestamp: result.rows[0],
      environment: config.NODE_ENV,
      endpoints: {
        auth: '/api/auth',
        orders: '/api/orders',
        restaurants: '/api/restaurants',
        menus: '/api/menus',
        matching: '/api/matching',
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Health check failed');
    res.status(500).json({
      status: 'ERROR',
      message: 'Database connection failed',
      error: error.message,
    });
  }
});

// ============================================================
// 404 Handler
// ============================================================
app.use((req, res) => {
  logger.warn(`404 - ${req.method} ${req.url}`);
  res.status(404).json({
    status: 'ERROR',
    message: 'Not Found',
  });
});

// ============================================================
// Sentry error handler (ต้องอยู่ก่อน error middleware อื่น เพื่อ capture error ได้)
// ============================================================
Sentry.setupExpressErrorHandler(app);

// ============================================================
// Error Handler
// ============================================================
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      status: 'ERROR',
      message: 'Request too large. Maximum size is 10kb.',
    });
  }
  logger.error({ error: err.message }, 'Server error');
  res.status(500).json({
    status: 'ERROR',
    message: 'Internal Server Error',
    error: config.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============================================================
// Start Server
// ============================================================
app.listen(config.PORT, () => {
  logger.info(`Server running on http://localhost:${config.PORT}`);
  logger.info(`Environment: ${config.NODE_ENV}`);
  logger.info(`Database: ${config.DB.host}:${config.DB.port}/${config.DB.name}`);
  logger.info('Available endpoints:');

  // Auth (Phase 3)
  logger.info('  POST   /api/auth/register');
  logger.info('  POST   /api/auth/login');
  logger.info('  GET    /api/auth/me');

  // Orders (Phase 3)
  logger.info('  POST   /api/orders');
  logger.info('  GET    /api/orders');
  logger.info('  GET    /api/orders/:orderId');
  logger.info('  PATCH  /api/orders/:orderId/status');

  // Restaurants (Phase 4)
  logger.info('  POST   /api/restaurants/register');
  logger.info('  GET    /api/restaurants/mine');
  logger.info('  GET    /api/restaurants/nearby');
  logger.info('  GET    /api/restaurants/:restaurantId');
  logger.info('  PATCH  /api/restaurants/:restaurantId');
  logger.info('  PATCH  /api/restaurants/:restaurantId/active-status');

  // Menus (Phase 4)
  logger.info('  POST   /api/menus');
  logger.info('  POST   /api/menus/bulk');
  logger.info('  GET    /api/menus/restaurant/:restaurantId');
  logger.info('  GET    /api/menus/:menuItemId');
  logger.info('  PATCH  /api/menus/:menuItemId');
  logger.info('  PATCH  /api/menus/:menuItemId/availability');
  logger.info('  DELETE /api/menus/:menuItemId');
  logger.info('  POST   /api/menus/search');

  // Matching (Phase 4)
  logger.info('  POST   /api/matching/find');
});