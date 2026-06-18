const { logSecurityEvent } = require('./securityLogger');

const loginAttempts = {};

const loginLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 50;

  if (!loginAttempts[ip]) {
    loginAttempts[ip] = { count: 0, firstAttempt: now };
  }

  const record = loginAttempts[ip];

  // Reset if window expired
  if (now - record.firstAttempt > windowMs) {
    loginAttempts[ip] = { count: 0, firstAttempt: now };
  }

  if (record.count >= maxAttempts) {
    const remaining = Math.ceil((windowMs - (now - record.firstAttempt)) / 60000);
    logSecurityEvent('BRUTE_FORCE_BLOCKED', req, { attemptCount: record.count });
    return res.status(429).json({
      status: 'ERROR',
      message: `Too many login attempts. Please try again in ${remaining} minutes.`
    });
  }

  record.count++;
  next();
};

const resetLoginAttempts = (ip) => {
  delete loginAttempts[ip];
};

module.exports = { loginLimiter, resetLoginAttempts };
