const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const { loginLimiter, resetLoginAttempts } = require('../middleware/loginLimit');
const { createRateLimiter } = require('../middleware/rateLimit');
const registerLimiter = createRateLimiter({ maxRequests: 5, windowMs: 60 * 60 * 1000, message: 'Too many accounts created. Please try again later.' });
const forgotPasswordLimiter = createRateLimiter({ maxRequests: 3, windowMs: 60 * 60 * 1000, message: 'Too many password reset requests. Please try again later.' });
const { generateSecret, generateQRCodeUrl, verifyToken } = require('../utils/totp');
const QRCode = require('qrcode');
const { logSecurityEvent } = require('../middleware/securityLogger');
const { auditLog } = require('../middleware/auditLog');
const pool = require('../db');

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ status: 'ERROR', message: 'Email, password, and name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ status: 'ERROR', message: 'Password must be at least 8 characters' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ status: 'ERROR', message: 'Invalid email format' });
    }
    const user = await userService.registerUser(email, password, name);
    const jwt = require('jsonwebtoken');
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
    return res.status(201).json({
      status: 'OK',
      message: 'User registered successfully',
      accessToken,
      data: user,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Register endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: 'ERROR', message: 'Email and password are required' });
    }
    const result = await userService.loginUser(email, password);
    return res.status(200).json({
      status: 'OK',
      message: 'Login successful',
      accessToken: result.accessToken,
      data: result.user,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Login endpoint error');
    return res.status(401).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/auth/restaurant-login
router.post('/restaurant-login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: 'ERROR', message: 'Email and password are required' });
    }
    const result = await userService.loginUser(email, password);
    if (!result.user || result.user.role !== 'restaurant') {
      return res.status(401).json({ status: 'ERROR', message: 'Not a restaurant account' });
    }
    const db = require('../db');
    const restResult = await db.query(
      'SELECT id FROM restaurants WHERE owner_user_id = $1 LIMIT 1',
      [result.user.id]
    );
    const restaurantId = restResult.rows[0]?.id || null;

    const jwt = require('jsonwebtoken');
    const newToken = jwt.sign(
      { userId: result.user.id, email: result.user.email, role: result.user.role, restaurantId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    return res.status(200).json({
      status: 'OK',
      message: 'Restaurant login successful',
      accessToken: newToken,
      data: result.user,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Restaurant login error');
    return res.status(401).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/auth/restaurant-register
router.post('/restaurant-register', registerLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ status: 'ERROR', message: 'Email, password, and name are required' });
    }
    const user = await userService.registerUser(email, password, name, 'restaurant');
    const jwt = require('jsonwebtoken');
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
    return res.status(201).json({
      status: 'OK',
      message: 'Restaurant registered successfully',
      accessToken,
      data: user,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Restaurant register error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/auth/admin-2fa-setup
// ใช้ครั้งเดียวตอน setup 2FA — สร้าง secret ใหม่ + แสดง QR code ให้ scan
// ⚠️ ลบ/ปิด route นี้หลัง setup เสร็จ ป้องกันคนอื่นมาสร้าง secret ใหม่ทับ
router.get('/admin-2fa-setup', (req, res, next) => { if (process.env.NODE_ENV === 'production') return res.status(404).json({ status: 'ERROR', message: 'Not found' }); next(); }, async (req, res) => {
  try {
    const secret = generateSecret();
    const otpUrl = generateQRCodeUrl(secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpUrl);
    return res.status(200).json({
      status: 'OK',
      message: 'Scan this QR code with Google Authenticator, then save the secret to ADMIN_TOTP_SECRET env var on Render',
      secret,
      qrCodeDataUrl,
    });
  } catch (error) {
    logger.error({ error: error.message }, '2FA setup error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/auth/admin-login
router.post('/admin-login', loginLimiter, async (req, res) => {
  try {
    const { password, totpToken } = req.body;
    const crypto = require('crypto');
    const supplied = Buffer.from(password || '');
    const expected = Buffer.from(process.env.ADMIN_PASSWORD || '');
    const passwordMatch = supplied.length === expected.length &&
      crypto.timingSafeEqual(supplied, expected);
    if (!passwordMatch) {
      return res.status(401).json({ status: 'ERROR', message: 'Invalid admin password' });
    }

    // --- 2FA verification ---
    if (!process.env.ADMIN_TOTP_SECRET) {
      logger.error({}, 'ADMIN_TOTP_SECRET not configured — 2FA setup incomplete');
      return res.status(500).json({ status: 'ERROR', message: 'Admin 2FA not configured. Contact developer.' });
    }
    if (!totpToken) {
      return res.status(400).json({ status: 'ERROR', message: '2FA code is required' });
    }
    const isValidTotp = await verifyToken(totpToken, process.env.ADMIN_TOTP_SECRET);
    if (!isValidTotp) {
      logSecurityEvent('ADMIN_2FA_FAILED', req, {});
      return res.status(401).json({ status: 'ERROR', message: 'Invalid 2FA code' });
    }

    const jwt = require('jsonwebtoken');
    const accessToken = jwt.sign(
      { userId: 0, email: 'admin@billtable.com', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
    auditLog(0, 'admin@billtable.com', 'admin', 'ADMIN_LOGIN', null, null, req.ip, null);
    return res.status(200).json({
      status: 'OK',
      message: 'Admin login successful',
      accessToken,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Admin login error');
    return res.status(401).json({ status: 'ERROR', message: error.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ status: 'ERROR', message: 'User not found' });
    }
    return res.status(200).json({ status: 'OK', data: user });
  } catch (error) {
    logger.error({ error: error.message }, 'Get user endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/auth/logout - revoke the current access token so it can no
// longer be used, even though it has not expired yet (#3 fix).
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const token = req.token;
    const decoded = require('../utils/jwt').verifyToken(token, false);
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO revoked_tokens (token, user_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO NOTHING`,
      [token, req.user.userId, expiresAt]
    );

    return res.status(200).json({ status: 'OK', message: 'Logged out successfully' });
  } catch (error) {
    logger.error({ error: error.message }, 'Logout endpoint error');
    return res.status(400).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ status: 'ERROR', message: 'Email is required' });

    const userResult = await pool.query('SELECT id, name FROM users WHERE email = $1', [email]);
    // ไม่บอกว่า email มีหรือไม่มี (security best practice)
    if (userResult.rows.length === 0) {
      return res.status(200).json({ status: 'OK', message: 'If this email exists, a reset link has been sent.' });
    }

    const user = userResult.rows[0];
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // ลบ token เก่า แล้วสร้างใหม่
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    const resetLink = `https://billtable.co/reset-password?token=${token}`;
    const { sendPasswordResetEmail } = require('../services/emailService');
    await sendPasswordResetEmail({ toEmail: email, toName: user.name, resetLink });

    return res.status(200).json({ status: 'OK', message: 'If this email exists, a reset link has been sent.' });
  } catch (error) {
    logger.error({ error: error.message }, 'Forgot password error');
    return res.status(500).json({ status: 'ERROR', message: 'Something went wrong' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ status: 'ERROR', message: 'Token and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ status: 'ERROR', message: 'Password must be at least 8 characters' });
    }

    const tokenResult = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );
    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ status: 'ERROR', message: 'Invalid or expired reset link' });
    }

    const resetToken = tokenResult.rows[0];
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hashedPassword, resetToken.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [resetToken.id]);

    logger.info({ userId: resetToken.user_id }, 'Password reset successful');
    return res.status(200).json({ status: 'OK', message: 'Password reset successfully. Please log in.' });
  } catch (error) {
    logger.error({ error: error.message }, 'Reset password error');
    return res.status(500).json({ status: 'ERROR', message: 'Something went wrong' });
  }
});

// DELETE /api/auth/account
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    await pool.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)', [userId]);
    await pool.query('DELETE FROM orders WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM revoked_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    logger.info({ userId }, 'Account deleted');
    return res.status(200).json({ status: 'OK', message: 'Account deleted successfully' });
  } catch (error) {
    logger.error({ error: error.message }, 'Delete account error');
    return res.status(500).json({ status: 'ERROR', message: 'Something went wrong' });
  }
});

module.exports = router;
