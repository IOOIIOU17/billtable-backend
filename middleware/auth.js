/**
 * ============================================================
 * BillTable Auth Middleware
 * ============================================================
 * Purpose: HTTP middleware that verifies JWT tokens on
 *          protected routes.
 * 
 * How it works:
 *   1. Read the Authorization header
 *   2. Extract the token (format: "Bearer <token>")
 *   3. Verify the token using utils/jwt.js
 *   4. Attach decoded user info to req.user
 *   5. Pass control to the next handler
 * 
 * If anything fails, reject the request with 401 Unauthorized.
 * 
 * Created: Phase 4 (to support restaurantRoutes + menuRoutes)
 * ============================================================
 */

const { verifyToken } = require('../utils/jwt');

/**
 * Middleware that requires a valid JWT access token.
 * Attaches decoded payload to req.user.
 * 
 * Usage in routes:
 *   router.get('/profile', authenticateToken, (req, res) => {
 *       console.log(req.user.userId);
 *   });
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Missing Authorization header',
        });
    }

    // Expected format: "Bearer <token>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({
            error: 'Invalid authentication format',
            message: 'Authorization header must be: Bearer <token>',
        });
    }

    const token = parts[1];

    // Verify with utils/jwt.js (returns decoded payload or null)
    const decoded = verifyToken(token, false);

    if (!decoded) {
        return res.status(401).json({
            error: 'Invalid or expired token',
            message: 'Please log in again',
        });
    }

    // Attach decoded info to request for downstream handlers
    req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
    };

    next();
}

/**
 * Middleware that requires a specific role.
 * Use AFTER authenticateToken in the middleware chain.
 * 
 * Usage:
 *   router.delete('/admin/users/:id',
 *       authenticateToken,
 *       requireRole('admin'),
 *       handler
 *   );
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Permission denied',
                message: `Requires one of: ${allowedRoles.join(', ')}`,
            });
        }

        next();
    };
}

module.exports = {
    authenticateToken,
    requireRole,
};