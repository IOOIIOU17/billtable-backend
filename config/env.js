require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  JWT: {
    secret: process.env.JWT_SECRET,
    expiry: process.env.JWT_EXPIRE
  },
  REFRESH_TOKEN: {
    secret: process.env.REFRESH_TOKEN_SECRET,
    expiry: process.env.REFRESH_TOKEN_EXPIRE
  },
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  RATE_LIMIT: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || 100)
  }
};
