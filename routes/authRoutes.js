const { loginLimiter, resetLoginAttempts } = require('../middleware/loginLimit');
/**
 * ============================================================
 * BillTable Auth Routes
 * ============================================================
 * Purpose: HTTP endpoints for user authentication
 * Handles: Registration, login, get current user
 * 
 * Mounted at: /api/auth
 * Created: Phase 3 (rewritten Phase 4 to align middleware names)
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

/**
 * POST /api/auth/register
 * Register a new user account.
 * 
 * Request body example:
 * {
 *   "email": "tony@billtable.com",
 *   "password": "securePass123",
 *   "name": "Tony"
 * }
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Validation
        if (!email || !password || !name) {
            return res.status(400).json({
                status: 'ERROR',
                message: 'Email, password, and name are required',
            });
        }
        if (password.length < 8) {
            return res.status(400).json({
                status: 'ERROR',
                message: 'Password must be at least 8 characters',
            });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'ERROR',
                message: 'Invalid email format',
            });
        }

        const user = await userService.registerUser(email, password, name);

        return res.status(201).json({
            status: 'OK',
            message: 'User registered successfully',
            data: user,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Register endpoint error');
        return res.status(400).json({
            status: 'ERROR',
            message: error.message,
        });
    }
});

/**
 * POST /api/auth/login
 * Log in an existing user.
 * Returns access token and user data on success.
 * 
 * Request body example:
 * {
 *   "email": "tony@billtable.com",
 *   "password": "securePass123"
 * }
 */
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({
                status: 'ERROR',
                message: 'Email and password are required',
            });
        }

        const result = await userService.loginUser(email, password);

        return res.status(200).json({
            status: 'OK',
            message: 'Login successful',
            data: result,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Login endpoint error');
        return res.status(401).json({
            status: 'ERROR',
            message: error.message,
        });
    }
});

/**
 * GET /api/auth/me
 * Get the currently logged-in user's profile.
 * Requires valid JWT in Authorization header.
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await userService.getUserById(req.user.userId);

        if (!user) {
            return res.status(404).json({
                status: 'ERROR',
                message: 'User not found',
            });
        }

        return res.status(200).json({
            status: 'OK',
            data: user,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Get user endpoint error');
        return res.status(400).json({
            status: 'ERROR',
            message: error.message,
        });
    }
});

module.exports = router;