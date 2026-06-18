// ============================================================
// securityLogger.js
// บันทึก security event แยกจาก log ทั่วไป — ใช้ logger (Pino) ตัวเดิม
// แต่เพิ่ม field securityEvent: true เพื่อกรองหาได้ง่ายใน Render logs
// ============================================================

const { logger } = require('./logger');

// บันทึกเหตุการณ์ที่น่าสงสัย พร้อมรายละเอียดที่จำเป็นต่อการสืบสวนทีหลัง
function logSecurityEvent(eventType, req, details = {}) {
  logger.warn({
    securityEvent: true,
    eventType, // เช่น 'BRUTE_FORCE_BLOCKED', 'IDOR_BLOCKED', 'JWT_INVALID', 'INVALID_ORDER_ID'
    ip: req.ip || req.connection?.remoteAddress,
    method: req.method,
    url: req.originalUrl || req.url,
    userId: req.user?.userId || null,
    ...details,
  }, `Security event: ${eventType}`);
}

module.exports = { logSecurityEvent };
