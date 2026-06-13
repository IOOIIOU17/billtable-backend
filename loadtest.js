const BASE_URL = 'https://billtable-backend.onrender.com';

// จุดศูนย์กลาง: SoFi Stadium
const CENTER_LAT = 33.9535;
const CENTER_LNG = -118.3392;

const CUISINES = [null, 'American', 'BBQ', 'Mexican', 'Italian', 'Japanese', 'Mediterranean', 'Thai', 'Vietnamese', 'Korean'];

function randomOffset() {
  // สุ่มจุดในรัศมีประมาณ 3 ไมล์รอบ SoFi (~0.04 องศา)
  return (Math.random() - 0.5) * 0.08;
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@billtable.com', password: 'test1234' }),
  });
  const data = await res.json();
  if (!data.accessToken) throw new Error('Login failed: ' + JSON.stringify(data));
  return data.accessToken;
}

async function fireRequest(token, i) {
  const body = {
    latitude: CENTER_LAT + randomOffset(),
    longitude: CENTER_LNG + randomOffset(),
    cuisine_type: CUISINES[Math.floor(Math.random() * CUISINES.length)],
    budget: 50 + Math.floor(Math.random() * 100),
    guest_count: 1 + Math.floor(Math.random() * 10),
    allergies: [],
    avoid_spicy: false,
  };

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${BASE_URL}/api/matching/find`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    const ms = Date.now() - start;
    return { i, ok: res.ok, status: res.status, ms, count: data.count ?? -1, cuisine: body.cuisine_type };
  } catch (err) {
    clearTimeout(timeout);
    return { i, ok: false, status: 0, ms: Date.now() - start, error: err.message };
  }
}

async function runBatch(token, n) {
  console.log(`\n=== Load Test: ${n} concurrent requests ===`);
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => fireRequest(token, i))
  );
  const totalMs = Date.now() - start;

  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  const times = results.map(r => r.ms);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  const min = Math.min(...times);

  console.log(`Total wall time: ${totalMs}ms`);
  console.log(`Success: ${ok.length}/${n}  Failed: ${failed.length}/${n}`);
  console.log(`Response time -> avg: ${avg.toFixed(0)}ms  min: ${min}ms  max: ${max}ms`);

  const avgCount = ok.reduce((a, r) => a + (r.count >= 0 ? r.count : 0), 0) / (ok.length || 1);
  console.log(`Avg matched restaurants per request: ${avgCount.toFixed(1)}`);

  if (failed.length > 0) {
    console.log('Failed samples:', failed.slice(0, 3));
  }
}

(async () => {
  console.log('Logging in...');
  const token = await login();
  console.log('Token acquired ✓');

  await runBatch(token, 2);
  await runBatch(token, 10);
  await runBatch(token, 100);
  await runBatch(token, 500);
  await runBatch(token, 1000);
})();
