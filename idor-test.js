const jwt = require('jsonwebtoken');
const SECRET = '7bd1365c86d666e5c6a51ba9a8b4128daa0bb37c5cc24fc2f8ecc1ccd3f03005d228a57aff07350b70d0660381d2ed20cb4d397a01888dca9aa090ce7743d4489';
const BASE = 'https://billtable-backend.onrender.com';

const tokenStranger = jwt.sign({ userId: 999, email: 'stranger@x.com', role: 'customer' }, SECRET, { expiresIn: '1h' });
const tokenOwner    = jwt.sign({ userId: 48,  email: 'owner@x.com',    role: 'customer' }, SECRET, { expiresIn: '1h' });
const tokenRestaurant = jwt.sign({ userId: 4, email: 'r@x.com', role: 'restaurant' }, SECRET, { expiresIn: '1h' });

async function get(name, token) {
  const res = await fetch(`${BASE}/api/orders/1`, { headers: { Authorization: `Bearer ${token}` } });
  console.log(`${name}: GET -> HTTP ${res.status}`);
}

async function patch(name, token, status) {
  const res = await fetch(`${BASE}/api/orders/1/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`${name}: PATCH -> HTTP ${res.status} -> ${JSON.stringify(body).slice(0,80)}`);
}

(async () => {
  await get('1. Stranger (userId=999) GET order#1     ', tokenStranger);
  await get('2. Real owner (userId=48) GET order#1    ', tokenOwner);
  await get('3. Restaurant owner (userId=4) GET order#1', tokenRestaurant);
  await patch('4. Stranger PATCH status                 ', tokenStranger, 'pending');
  await patch('5. Restaurant owner PATCH status (pending)', tokenRestaurant, 'pending');
})();
