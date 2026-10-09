// utils/geocode.js
// Turns a typed US street address into latitude/longitude, for customers
// who type their delivery address instead of tapping "Use my location".
// The customer app never sent coordinates for a typed address, so
// POST /api/addresses refused it and new customers could not get past
// "When and where" (found 8 Oct 2026). Doing it here also fixes the app
// builds already installed on phones.
//
// 1) US Census Bureau geocoder: free, no key, made for US street addresses.
// 2) OpenStreetMap Nominatim as a fallback (needs a real User-Agent).
// Returns { latitude, longitude } or null. Never throws.

const fetchFn = globalThis.fetch || require('node-fetch');

const TIMEOUT_MS = 6000;
const USER_AGENT = 'TigTagTrue/1.0 (support@tigtagtrue.com)';

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const valid = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

async function fromCensus(address) {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
    + `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const j = await getJson(url);
  const c = j?.result?.addressMatches?.[0]?.coordinates;
  const lat = Number(c?.y);
  const lng = Number(c?.x);
  return valid(lat, lng) ? { latitude: lat, longitude: lng } : null;
}

async function fromNominatim(address) {
  const url = 'https://nominatim.openstreetmap.org/search'
    + `?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`;
  const j = await getJson(url, { 'User-Agent': USER_AGENT });
  const hit = Array.isArray(j) ? j[0] : null;
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  return valid(lat, lng) ? { latitude: lat, longitude: lng } : null;
}

async function geocodeAddress(address) {
  const q = String(address || '').trim().slice(0, 300);
  if (q.length < 5) return null;
  return (await fromCensus(q)) || (await fromNominatim(q));
}

module.exports = { geocodeAddress };
