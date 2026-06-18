// ============================================================
// totp.js
// TOTP (Time-based One-Time Password) utility สำหรับ Admin 2FA
// ใช้ otplib — มาตรฐานเดียวกับ Google Authenticator / Authy
// ============================================================

const { authenticator } = require('otplib');

// สร้าง secret ใหม่ (ใช้แค่ครั้งเดียวตอน setup — เก็บผลลัพธ์ไว้ใน ADMIN_TOTP_SECRET env var)
function generateSecret() {
  return authenticator.generateSecret();
}

// สร้าง URL สำหรับทำ QR code (ใช้ scan ด้วย Google Authenticator)
function generateQRCodeUrl(secret, accountName = 'BillTable Admin') {
  return authenticator.keyuri(accountName, 'BillTable', secret);
}

// ตรวจสอบโค้ด 6 หลักที่ผู้ใช้กรอกเข้ามา ตรงกับ secret ไหม
function verifyToken(token, secret) {
  try {
    return authenticator.verify({ token, secret });
  } catch (err) {
    return false;
  }
}

module.exports = { generateSecret, generateQRCodeUrl, verifyToken };
