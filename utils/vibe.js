// Restaurant "vibe" profile: the fixed choices a restaurant picks from, and
// how a customer's party is scored against them. Used by matching (Smart
// Match) and by Browse (customer picks the restaurant themselves).

const VIBE_TAGS = ['Cozy', 'Lively', 'Elegant', 'Casual', 'Family-friendly', 'Romantic', 'Trendy', 'Patio', 'Quiet', 'Festive'];
const OCCASIONS = ['Birthday', 'Wedding', 'Game Day', 'Office Party', 'Graduation', 'Potluck', 'Family Gathering', 'Date Night', 'Holiday Party'];
const PARKING_TYPES = ['Street', 'Own lot', 'Garage nearby', 'Valet', 'No parking'];

// Which vibes suit which occasion.
const OCCASION_VIBES = {
  'Birthday': ['Lively', 'Festive', 'Casual', 'Family-friendly'],
  'Wedding': ['Elegant', 'Romantic', 'Quiet'],
  'Game Day': ['Lively', 'Casual'],
  'Office Party': ['Casual', 'Lively', 'Quiet'],
  'Graduation': ['Festive', 'Family-friendly', 'Lively'],
  'Potluck': ['Casual', 'Family-friendly', 'Cozy'],
  'Family Gathering': ['Family-friendly', 'Cozy', 'Casual'],
  'Date Night': ['Romantic', 'Elegant', 'Quiet', 'Cozy'],
  'Holiday Party': ['Festive', 'Lively', 'Cozy'],
};

// The customer's free theme text (from the theme screen) → one occasion.
function occasionFromTheme(theme) {
  const t = String(theme || '').toLowerCase();
  if (!t) return null;
  if (t.includes('birthday') || t.includes('bday')) return 'Birthday';
  if (t.includes('wedding') || t.includes('engagement')) return 'Wedding';
  if (t.includes('office') || t.includes('work') || t.includes('team')) return 'Office Party';
  if (t.includes('game')) return 'Game Day';
  if (t.includes('graduat')) return 'Graduation';
  if (t.includes('potluck')) return 'Potluck';
  if (t.includes('family') || t.includes('reunion')) return 'Family Gathering';
  if (t.includes('date') || t.includes('anniversary')) return 'Date Night';
  if (t.includes('halloween') || t.includes('christmas') || t.includes('holiday') || t.includes('thanksgiving') || t.includes('new year')) return 'Holiday Party';
  return null;
}

const clean = (list, allowed) => {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    const hit = allowed.find((a) => a.toLowerCase() === String(v).trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
};

// What a restaurant still has to fill in before its profile is complete.
function profileMissing(r) {
  const missing = [];
  if (!r?.cover_image_url) missing.push('Storefront photo');
  if (!r?.vibe_text || String(r.vibe_text).trim().length < 30) missing.push('Atmosphere (30+ characters)');
  if (!r?.vibe_tags || r.vibe_tags.length === 0) missing.push('Vibe');
  if (!r?.best_for || r.best_for.length === 0) missing.push('Best for');
  if (!r?.price_level) missing.push('Price level');
  if (!r?.parking_type) missing.push('Parking');
  return missing;
}

// How well one restaurant fits one party, 0–100, plus plain-English reasons.
// Weights: occasion/vibe 30, budget 25, menu safety 20, distance 15, rating 10.
function fitFor({ restaurant, theme, distance, safeCount, totalCount, estimatedTotal, budget, guestCount, rating, allergies, avoidSpicy }) {
  const reasons = [];
  const occasion = occasionFromTheme(theme);
  const bestFor = restaurant.best_for || [];
  const tags = restaurant.vibe_tags || [];

  // Occasion / vibe (30)
  let vibe = 8;
  if (occasion && bestFor.includes(occasion)) {
    vibe = 30;
    reasons.push(`Made for a ${occasion.toLowerCase()}`);
  } else if (occasion) {
    const good = tags.filter((t) => (OCCASION_VIBES[occasion] || []).includes(t));
    if (good.length) {
      vibe = Math.min(24, 12 + good.length * 6);
      reasons.push(`${good.join(' & ')} vibe suits a ${occasion.toLowerCase()}`);
    }
  } else if (tags.length) {
    vibe = 15;
  }
  const themeWord = String(theme || '').trim().toLowerCase();
  if (themeWord.length > 3 && String(restaurant.vibe_text || '').toLowerCase().includes(themeWord)) {
    vibe = Math.min(30, vibe + 6);
  }

  // Budget (25)
  let money = 18;
  const b = Number(budget) || 0;
  if (b > 0 && estimatedTotal > 0) {
    if (estimatedTotal <= b) {
      money = 25;
      const per = guestCount > 0 ? Math.round(b / guestCount) : null;
      reasons.push(per ? `Fits your $${per}/person budget` : 'Fits your budget');
    } else {
      money = Math.round(25 * (b / estimatedTotal));
    }
  }

  // Menu safety (20)
  const menu = totalCount > 0 ? Math.round(20 * Math.min(1, safeCount / Math.max(5, Math.min(totalCount, 8)))) : 0;
  if ((allergies && allergies.length) || avoidSpicy) {
    reasons.push(`${safeCount} dish${safeCount === 1 ? '' : 'es'} safe for ${allergies && allergies.length ? 'your allergies' : 'no-spicy'}`);
  }

  // Distance (15)
  const dist = Math.max(0, Math.round(15 - distance * 1.5));
  if (distance <= 3) reasons.push(`Only ${Math.round(distance * 10) / 10} mi away`);

  // Rating (10)
  let stars = 6;
  if (rating && rating.count > 0) {
    stars = Math.round((Number(rating.avg) / 5) * 10);
    if (Number(rating.avg) >= 4.5) reasons.push(`Guests love it (★ ${rating.avg})`);
  }

  let fit = vibe + money + menu + dist + stars;
  if (profileMissing(restaurant).length) fit -= 5;
  return { fit: Math.max(1, Math.min(99, fit)), reasons: reasons.slice(0, 4), occasion };
}

module.exports = { VIBE_TAGS, OCCASIONS, PARKING_TYPES, OCCASION_VIBES, occasionFromTheme, clean, profileMissing, fitFor };
