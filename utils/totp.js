// ============================================================
// totp.js
// TOTP (Time-based One-Time Password) utility สำหรับ Admin 2FA
// ใช้ otplib@13.x — API แบบ object parameter (ไม่ใช่ authenticator namespace)
// ============================================================

const { generateSecret: otplibGenerateSecret, generateURI, verify } = require('otplib');

// สร้าง secret ใหม่ (ใช้แค่ครั้งเดียวตอน setup — เก็บผลลัพธ์ไว้ใน ADMIN_TOTP_SECRET env var)
function generateSecret() {
  return otplibGenerateSecret();
}

// สร้าง URL สำหรับทำ QR code (ใช้ scan ด้วย Google Authenticator)
function generateQRCodeUrl(secret, accountName = 'BillTable Admin') {
  return generateURI({
    strategy: 'totp',
    issuer: 'BillTable',
    label: accountName,
    secret,
  });
}

// ตรวจสอบโค้ด 6 หลักที่ผู้ใช้กรอกเข้ามา ตรงกับ secret ไหม
async function verifyToken(token, secret) {
  try {
    return await verify({ secret, token });
  } catch (err) {
    return false;
  }
}

module.exports = { generateSecret, generateQRCodeUrl, verifyToken };
