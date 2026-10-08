// ============================================================
// matchingService.js - หัวใจของ TigTagTrue
// จับคู่ requirements ของลูกค้า กับ ร้าน + เมนูที่ลงตัว
// ============================================================

const pool = require('../db');
const { getRatingSummaries } = require('./ratingService');
const { whyNot } = require('../utils/availability');
const { fitFor, profileMissing } = require('../utils/vibe');

// --- Cache รายชื่อร้านที่ active (STEP 1) — TTL 30 วินาที ---
// เหตุผล: ทุก request ของ matching ต้อง query รายการนี้เหมือนกันหมด
// แต่รายชื่อร้านเปลี่ยนไม่บ่อย -> cache ไว้ลด DB load ตอนคนสั่งพร้อมกันมากๆ
let restaurantsCache = null;
let restaurantsCacheTime = 0;
const RESTAURANTS_CACHE_TTL = 30 * 1000;

async function getActiveRestaurants() {
  const now = Date.now();
  if (restaurantsCache && (now - restaurantsCacheTime) < RESTAURANTS_CACHE_TTL) {
    return restaurantsCache;
  }
  const result = await pool.query(
    'SELECT * FROM restaurants WHERE is_active = true AND is_deleted = false'
  );
  restaurantsCache = result.rows;
  restaurantsCacheTime = now;
  return restaurantsCache;
}

// ============================================================
// HELPER 1: คำนวณระยะทางระหว่าง 2 จุด (Haversine formula)
// คืนค่าเป็นไมล์
// ============================================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8; // รัศมีโลก หน่วยไมล์

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================
// HELPER 2: เช็คว่าเมนูมีของแพ้หรือไม่
// คืน true ถ้าปลอดภัย (ไม่มีของแพ้)
// ============================================================
function isMenuSafeForAllergies(menu, allergies) {
  if (!allergies || allergies.length === 0) return true;
  if (!menu.allergens || menu.allergens.length === 0) return true;

  // ถ้าเมนูมีของที่ลูกค้าแพ้ → ไม่ปลอดภัย
  const menuAllergens = menu.allergens.map((a) => a.toLowerCase());
  for (const allergy of allergies) {
    if (menuAllergens.includes(allergy.toLowerCase())) {
      return false;
    }
  }
  return true;
}

// ============================================================
// HELPER 3: เช็คว่าเมนูตรงรสชาติที่ต้องการหรือไม่
// avoidSpicy = true → ตัดเมนูที่ spicy_level สูง
// ============================================================
function isMenuMatchTaste(menu, avoidSpicy) {
  if (avoidSpicy && menu.spicy_level >= 3) {
    return false;
  }
  return true;
}

// ============================================================
// HELPER 4: ให้คะแนนร้าน (ยิ่งสูง = ยิ่งดี)
// ============================================================
function calculateScore(restaurant, distance, matchedMenuCount) {
  let score = 100;

  // ยิ่งใกล้ ยิ่งได้คะแนนสูง (ลบตามระยะทาง)
  score -= distance * 2;

  // ยิ่งมีเมนูที่ match เยอะ ยิ่งดี
  score += matchedMenuCount * 5;

  return Math.max(0, Math.round(score));
}

// ============================================================
// MAIN: findMatches - ตัวจับคู่หลัก
// ============================================================
async function findMatches(requirements) {
  const {
    latitude,
    longitude,
    cuisine_type,
    allergies = [],
    avoid_spicy = false,
    budget,
    guest_count = 1,
    delivery_time = null,
    theme = null,
    limit = 5,
  } = requirements;

  // --- STEP 1: ดึงร้านที่ active ทั้งหมด (จาก cache ถ้ายังไม่หมดอายุ) ---
  let restaurants = await getActiveRestaurants();

  // --- STEP 2: กรองตามระยะทาง (ในรัศมีส่งได้) ---
  const nearbyRestaurants = [];
  for (const r of restaurants) {
    if (r.latitude == null || r.longitude == null) continue;

    const distance = calculateDistance(
      latitude, longitude,
      parseFloat(r.latitude), parseFloat(r.longitude)
    );

    // TEMP (testing only): ถ้า radius < 4 ไมล์ หรือไม่มีค่า → ใช้ 100 ไมล์ชั่วคราว
    // TODO: เปลี่ยนกลับเป็น (r.delivery_radius_miles || 10) หลังมีร้านจริงเข้าระบบแล้ว
    const originalRadius = r.delivery_radius_miles || 10;
    const radius = originalRadius < 4 ? 100 : originalRadius;
    if (distance <= radius) {
      nearbyRestaurants.push({ ...r, distance });
    }
  }

  // --- STEP 3: กรองตาม cuisine type (ถ้าระบุ) ---
  // หมายเหตุ: ตาราง restaurants เก็บ cuisine_types เป็น array เช่น ["thai","chinese"]
  let filtered = nearbyRestaurants;
  if (cuisine_type) {
    filtered = filtered.filter((r) => {
      if (!r.cuisine_types || r.cuisine_types.length === 0) return false;
      const types = r.cuisine_types.map((t) => t.toLowerCase());
      return types.includes(cuisine_type.toLowerCase());
    });
  }

  // --- STEP 4: ดึงเมนูของทุกร้านที่ filtered แล้วในครั้งเดียว (แก้ N+1 query) ---
  const restaurantIds = filtered.map((r) => r.id);
  const menusByRestaurant = {};
  if (restaurantIds.length > 0) {
    const menuResult = await pool.query(
      'SELECT * FROM menus WHERE restaurant_id = ANY($1) AND is_available = true',
      [restaurantIds]
    );
    for (const menu of menuResult.rows) {
      if (!menusByRestaurant[menu.restaurant_id]) menusByRestaurant[menu.restaurant_id] = [];
      menusByRestaurant[menu.restaurant_id].push(menu);
    }
  }

  const ratings = await getRatingSummaries(restaurantIds);

  const matches = [];
  for (const restaurant of filtered) {
    const menus = menusByRestaurant[restaurant.id] || [];

    // Allergy + taste: only dishes this party can eat
    const safeMenus = menus.filter((menu) => (
      isMenuSafeForAllergies(menu, allergies) && isMenuMatchTaste(menu, avoid_spicy)
    ));
    if (safeMenus.length === 0) continue;

    const avgPrice =
      safeMenus.reduce((sum, m) => sum + parseFloat(m.price), 0) / safeMenus.length;
    const estimatedTotal = avgPrice * guest_count;

    // Busy mode, opening hours, notice period and minimum order: skip a
    // restaurant that could not actually do this party (utils/availability).
    if (whyNot(restaurant, { deliveryTime: delivery_time, foodTotal: estimatedTotal })) continue;

    // Fit 0–100 from occasion/vibe, budget, menu safety, distance, rating
    // (utils/vibe.js). Budget never removes a restaurant; it lowers the fit.
    const { fit, reasons } = fitFor({
      restaurant,
      theme,
      distance: restaurant.distance,
      safeCount: safeMenus.length,
      totalCount: menus.length,
      estimatedTotal,
      budget,
      guestCount: guest_count,
      rating: ratings[restaurant.id],
      allergies,
      avoidSpicy: avoid_spicy,
    });

    const toMenu = (m) => ({
      id: m.id,
      name: m.name,
      price: parseFloat(m.price),
      serving_size: m.serving_size || 1,
      spicy_level: m.spicy_level,
      image_url: m.image_url,
      description: m.description || null,
    });

    matches.push({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        cuisine_types: restaurant.cuisine_types,
        distance_miles: Math.round(restaurant.distance * 10) / 10,
        phone: restaurant.phone,
        address: restaurant.address,
        city: restaurant.city,
        rating_avg: ratings[restaurant.id]?.avg ?? null,
        rating_count: ratings[restaurant.id]?.count ?? 0,
        description: restaurant.description || null,
        cover_image_url: restaurant.cover_image_url || null,
        vibe_text: restaurant.vibe_text || null,
        vibe_tags: restaurant.vibe_tags || [],
        best_for: restaurant.best_for || [],
        price_level: restaurant.price_level || null,
        parking_type: restaurant.parking_type || null,
        parking_note: restaurant.parking_note || null,
        profile_complete: profileMissing(restaurant).length === 0,
      },
      recommended_menus: safeMenus.slice(0, 5).map(toMenu),
      all_safe_menus: safeMenus.slice(0, 12).map(toMenu),
      menu_count: safeMenus.length,
      estimated_total: Math.round(estimatedTotal * 100) / 100,
      fit_percent: fit,
      fit_reasons: reasons,
      score: fit,
    });
  }

  // Highest fit first. Smart Match uses the top one; Browse shows the list.
  matches.sort((a, b) => b.fit_percent - a.fit_percent);
  const cap = Math.max(1, Math.min(Number(limit) || 5, 30));

  return {
    success: true,
    count: matches.length,
    matches: matches.slice(0, cap),
  };
}

module.exports = {
  findMatches,
  calculateDistance,
  isMenuSafeForAllergies,
  isMenuMatchTaste,
  calculateScore,
};