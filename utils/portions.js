// Catering portions -- how many plates of each dish an order needs.
//
// Per Tony (2026-10-02): the RESTAURANT decides how big one plate is.
// One restaurant's large plate may feed 5 people, another's only 3. That
// is menus.serving_size ("one plate of this item feeds N people"), set by
// the restaurant on its menu screen. Default 1 = one plate per person.
//
// Guests are split evenly across the dishes in the order (the same
// "one serving per guest" assumption AI matching already uses for its
// price estimate), then rounded UP to whole plates so nobody goes short:
//   25 guests, 5 dishes, plate feeds 5  -> 5 guests/dish -> 1 plate each
//   25 guests, 5 dishes, plate feeds 3  -> 5 guests/dish -> 2 plates each
//   25 guests, 5 dishes, plate feeds 1  -> 5 guests/dish -> 5 plates each
function platesNeeded(guestCount, dishCount, servingSize) {
  const guests = parseInt(guestCount, 10);
  const dishes = parseInt(dishCount, 10);
  if (!Number.isFinite(guests) || guests < 1 || !Number.isFinite(dishes) || dishes < 1) return null;
  const feeds = Math.max(1, parseInt(servingSize, 10) || 1);
  const guestsPerDish = Math.ceil(guests / dishes);
  return Math.max(1, Math.ceil(guestsPerDish / feeds));
}

// Restaurant-entered serving size -> whole number 1..100, or null if not
// provided / not a number (caller decides the default).
function normalizeServingSize(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(1, n));
}

module.exports = { platesNeeded, normalizeServingSize };
