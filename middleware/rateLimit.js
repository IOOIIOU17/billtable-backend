// ============================================================
// rateLimit.js
// Generic rate limiter — ใช้ IP เป็น key, ปรับ maxAttempts/windowMs ได้
// ตาม endpoint ที่ความเสี่ยงต่างกัน (ดู Phase 11.6b Security Hardening)
// ============================================================

function createRateLimiter({ maxRequests, windowMs, message }) {
  const requestCounts = {};

  // เคลียร์ record เก่าทุก 10 นาที ป้องกัน memory leak จาก IP ที่ไม่กลับมาอีก
  setInterval(() => {
    const now = Date.now();
    for (const ip in requestCounts) {
      if (now - requestCounts[ip].firstRequest > windowMs) {
        delete requestCounts[ip];
      }
    }
  }, 10 * 60 * 1000);

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!requestCounts[ip]) {
      requestCounts[ip] = { count: 0, firstRequest: now };
    }

    const record = requestCounts[ip];

    if (now - record.firstRequest > windowMs) {
      requestCounts[ip] = { count: 0, firstRequest: now };
    }

    if (requestCounts[ip].count >= maxRequests) {
      const remaining = Math.ceil((windowMs - (now - requestCounts[ip].firstRequest)) / 1000);
      return res.status(429).json({
        status: 'ERROR',
        message: message || `Too many requests. Please try again in ${remaining} seconds.`,
      });
    }

    requestCounts[ip].count++;
    next();
  };
}

// --- Rate limiters แยกตามความเสี่ยง/ภาระของแต่ละ endpoint ---

// Matching API: หนักที่สุดต่อ database (ดู Phase 11 Load Test)
// 30 ครั้ง/นาที ต่อ IP — เกินกว่าที่ user จริงจะกดถี่ขนาดนั้น
const matchingLimiter = createRateLimiter({
  maxRequests: 30,
  windowMs: 60 * 1000,
  message: 'Too many matching requests. Please wait a moment and try again.',
});

// Create Order: ป้องกัน user/bot สร้าง order รัวๆ
// 10 ครั้ง/นาที ต่อ IP
const createOrderLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000,
  message: 'Too many order requests. Please wait a moment and try again.',
});

// General read endpoints: เบาที่สุด ป้องกัน scraping
// 100 ครั้ง/นาที ต่อ IP
const generalLimiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60 * 1000,
  message: 'Too many requests. Please slow down.',
});

module.exports = { matchingLimiter, createOrderLimiter, generalLimiter, createRateLimiter };
