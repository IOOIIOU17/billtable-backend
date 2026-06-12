// ============================================================
// matchingService.js - หัวใจของ BillTable
// จับคู่ requirements ของลูกค้า กับ ร้าน + เมนูที่ลงตัว
// ============================================================

const pool = require('../db');

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
  } = requirements;

  // --- STEP 1: ดึงร้านที่ active ทั้งหมด ---
  const restaurantResult = await pool.query(
    'SELECT * FROM restaurants WHERE is_active = true AND is_deleted = false'
  );
  let restaurants = restaurantResult.rows;

  // --- STEP 2: กรองตามระยะทาง (ในรัศมีส่งได้) ---
  const nearbyRestaurants = [];
  for (const r of restaurants) {
    if (r.latitude == null || r.longitude == null) continue;

    const distance = calculateDistance(
      latitude, longitude,
      parseFloat(r.latitude), parseFloat(r.longitude)
    );

    const radius = r.delivery_radius_miles || 10;
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

  const matches = [];
  for (const restaurant of filtered) {
    let menus = menusByRestaurant[restaurant.id] || [];

    // กรองเมนูตาม allergy + taste
    const safeMenus = menus.filter((menu) => {
      return (
        isMenuSafeForAllergies(menu, allergies) &&
        isMenuMatchTaste(menu, avoid_spicy)
      );
    });

    // ถ้าไม่มีเมนูที่ปลอดภัยเลย → ข้ามร้านนี้
    if (safeMenus.length === 0) continue;

    // --- STEP 5: กรองตาม budget ---
    // คำนวณราคาเฉลี่ยต่อคน
    const avgPrice =
      safeMenus.reduce((sum, m) => sum + parseFloat(m.price), 0) /
      safeMenus.length;
    const estimatedTotal = avgPrice * guest_count;

    // ถ้ามี budget และราคาประเมินเกิน budget → ข้าม
    if (budget && estimatedTotal > budget) continue;

    // --- คำนวณคะแนน ---
    const score = calculateScore(
      restaurant,
      restaurant.distance,
      safeMenus.length
    );

    matches.push({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        cuisine_types: restaurant.cuisine_types,
        distance_miles: Math.round(restaurant.distance * 10) / 10,
        phone: restaurant.phone,
        address: restaurant.address,
      },
      recommended_menus: safeMenus.slice(0, 5).map((m) => ({
        id: m.id,
        name: m.name,
        price: parseFloat(m.price),
        spicy_level: m.spicy_level,
        image_url: m.image_url,
      })),
      menu_count: safeMenus.length,
      estimated_total: Math.round(estimatedTotal * 100) / 100,
      score: score,
    });
  }

  // --- STEP 6: เรียงตามคะแนน สูง→ต่ำ คืน top 5 ---
  matches.sort((a, b) => b.score - a.score);

  return {
    success: true,
    count: matches.length,
    matches: matches.slice(0, 5),
  };
}

module.exports = {
  findMatches,
  calculateDistance,
  isMenuSafeForAllergies,
  isMenuMatchTaste,
  calculateScore,
};