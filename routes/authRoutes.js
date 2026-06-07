const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const { loginLimiter, resetLoginAttempts } = require('../middleware/loginLimit');

// POST /api/auth/register
router.post('/register', async (req, res) => {
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
    return res.status(200).json({
      status: 'OK',
      message: 'Restaurant login successful',
      accessToken: result.accessToken,
      data: result.user,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Restaurant login error');
    return res.status(401).json({ status: 'ERROR', message: error.message });
  }
});

// POST /api/auth/restaurant-register
router.post('/restaurant-register', async (req, res) => {
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

// POST /api/auth/admin-login
router.post('/admin-login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ status: 'ERROR', message: 'Invalid admin password' });
    }
    const jwt = require('jsonwebtoken');
    const accessToken = jwt.sign(
      { userId: 0, email: 'admin@billtable.com', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
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

module.exports = router;
