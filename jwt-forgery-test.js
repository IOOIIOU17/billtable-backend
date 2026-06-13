const jwt = require('jsonwebtoken');

const REAL_SECRET = '7bd1365c86d666e5c6a51ba9a8b4128daa0bb37c5cc24fc2f8ecc1ccd3f03005d228a57aff07350b70d0660381d2ed20cb4d397a01888dca9aa090ce7743d4489';
const BASE_URL = 'https://billtable-backend.onrender.com';
const TEST_ENDPOINT = '/api/restaurants/mine'; // ต้อง auth

const payload = { userId: 4, email: 'test3@billtable.com', role: 'restaurant' };

// 1. Genuine token (signed ด้วย secret จริง) — ใช้เป็น baseline ว่า endpoint ใช้งานได้ปกติ
const genuineToken = jwt.sign(payload, REAL_SECRET, { expiresIn: '1h' });

// 2. Forged: signed ด้วย secret ผิด (สมมติ hacker เดา secret)
const wrongSecretToken = jwt.sign(payload, 'wrongsecret123', { expiresIn: '1h' });

// 3. Forged: alg=none (ไม่มี signature เลย)
const noneAlgToken = jwt.sign(payload, '', { algorithm: 'none' });

// 4. Tampered: เอา genuine token มาแก้ payload (role -> admin) แต่ signature เดิม
const [header, , sig] = genuineToken.split('.');
const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, role: 'admin' })).toString('base64url');
const tamperedToken = `${header}.${tamperedPayload}.${sig}`;

async function test(name, token) {
  const res = await fetch(`${BASE_URL}${TEST_ENDPOINT}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await res.json().catch(() => ({}));
  console.log(`${name}: HTTP ${res.status} -> ${JSON.stringify(body).slice(0, 100)}`);
}

(async () => {
  await test('1. Genuine token        ', genuineToken);
  await test('2. Wrong-secret token   ', wrongSecretToken);
  await test('3. alg:none token       ', noneAlgToken);
  await test('4. Tampered role token  ', tamperedToken);
})();
