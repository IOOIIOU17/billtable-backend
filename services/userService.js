/**
 * ============================================================
 * BillTable User Service
 * ============================================================
 * Purpose: Business logic for user account management
 * Handles: Registration, login, profile retrieval, password
 * 
 * This service talks to the users table in the database.
 * Routes call these functions; this file is the only place
 * that writes raw SQL for user data.
 * 
 * Rewritten: Phase 4 (was corrupted by heredoc in Phase 3)
 * ============================================================
 */

const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateAccessToken } = require('../utils/jwt');

/**
 * Register a new user account.
 * Hashes password with bcrypt before storing.
 * 
 * @param {string} email - User's email address
 * @param {string} password - Plain text password (will be hashed)
 * @param {string} name - User's display name
 * @returns {Promise<Object>} The newly created user (without password)
 */
async function registerUser(email, password, name) {
    // Check if email already exists
    const existing = await db.query(
        'SELECT id FROM users WHERE email = $1 LIMIT 1',
        [email]
    );

    if (existing.rows.length > 0) {
        throw new Error('Email already registered');
    }

    // Hash password with bcrypt (cost factor 12)
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert new user
    const insertQuery = `
        INSERT INTO users (email, password, name)
        VALUES ($1, $2, $3)
        RETURNING id, email, name, role, created_at;
    `;

    const result = await db.query(insertQuery, [email, passwordHash, name]);
    return result.rows[0];
}

/**
 * Authenticate a user with email and password.
 * Returns user data and JWT access token on success.
 * 
 * @param {string} email - User's email
 * @param {string} password - Plain text password
 * @returns {Promise<Object>} { user, accessToken }
 */
async function loginUser(email, password) {
    // Find user by email (include password for comparison)
    const result = await db.query(
        'SELECT id, email, password, name, role FROM users WHERE email = $1 LIMIT 1',
        [email]
    );

    if (result.rows.length === 0) {
        throw new Error('Invalid email or password');
    }

    const user = result.rows[0];

    // Compare password against stored hash
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
        throw new Error('Invalid email or password');
    }

    // Generate JWT access token
    const accessToken = generateAccessToken(user.id, user.email, user.role);

    // Return user data (without password) + token
    return {
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        },
        accessToken,
    };
}

/**
 * Get user profile by ID.
 * Used by the /auth/me endpoint after JWT verification.
 * 
 * @param {number} userId - The user ID from JWT
 * @returns {Promise<Object|null>} User data or null if not found
 */
async function getUserById(userId) {
    const result = await db.query(
        'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1 LIMIT 1',
        [userId]
    );

    return result.rows[0] || null;
}

/**
 * Find user by email address.
 * Used for password reset flows and duplicate checking.
 * 
 * @param {string} email - The email to search
 * @returns {Promise<Object|null>} User data or null
 */
async function getUserByEmail(email) {
    const result = await db.query(
        'SELECT id, email, name, role FROM users WHERE email = $1 LIMIT 1',
        [email]
    );

    return result.rows[0] || null;
}

module.exports = {
    registerUser,
    loginUser,
    getUserById,
    getUserByEmail,
};