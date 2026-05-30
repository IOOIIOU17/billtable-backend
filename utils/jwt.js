const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { logger } = require('../middleware/logger');

// Generate Access Token
const generateAccessToken = (userId, email, role = 'user') => {
  try {
    const token = jwt.sign(
      { userId, email, role },
      config.JWT.secret,
      { expiresIn: config.JWT.expiry }
    );
    return token;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to generate access token');
    throw error;
  }
};

// Generate Refresh Token
const generateRefreshToken = (userId) => {
  try {
    const token = jwt.sign(
      { userId },
      config.REFRESH_TOKEN.secret,
      { expiresIn: config.REFRESH_TOKEN.expiry }
    );
    return token;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to generate refresh token');
    throw error;
  }
};

// Verify Token
const verifyToken = (token, isRefresh = false) => {
  try {
    const secret = isRefresh ? config.REFRESH_TOKEN.secret : config.JWT.secret;
    const decoded = jwt.verify(token, secret);
    return decoded;
  } catch (error) {
    logger.warn({ error: error.message }, 'Token verification failed');
    return null;
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken
};
