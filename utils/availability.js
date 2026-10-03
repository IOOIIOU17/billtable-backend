// When can a restaurant take an order? Used by matching (so customers are
// only matched with restaurants that can actually do the party) and again
// at order creation (so an order can never slip through).
//
// delivery_time is LA wall-clock ("YYYY-MM-DD HH:MM"), so everything here
// works in America/Los_Angeles wall-clock minutes, never UTC.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseWall(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return { y, mo, d, dow, minutes: h * 60 + mi, epochMin: Date.UTC(y, mo - 1, d, h, mi) / 60000 };
}

function laNowWall() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return parseWall(`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`);
}

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// business_hours accepts either one range for every day {open, close}
// (older restaurant web) or per day {monday: {open, close, closed}}.
// No hours set = open any time.
function hoursFor(businessHours, dow) {
  const bh = businessHours && typeof businessHours === 'object' ? businessHours : {};
  const day = bh[DAYS[dow]];
  if (day) return day;
  if (bh.open && bh.close) return { open: bh.open, close: bh.close };
  return null;
}

function isOpenAt(businessHours, wall) {
  const h = hoursFor(businessHours, wall.dow);
  if (!h) return true;
  if (h.closed) return false;
  const open = toMin(h.open);
  const close = toMin(h.close);
  if (open == null || close == null) return true;
  if (close > open) return wall.minutes >= open && wall.minutes <= close;
  return wall.minutes >= open || wall.minutes <= close; // past midnight
}

// Returns null if the restaurant can take it, otherwise a reason for the customer.
function whyNot(restaurant, { deliveryTime, foodTotal } = {}) {
  if (restaurant.busy_until && new Date(restaurant.busy_until).getTime() > Date.now()) {
    return 'This restaurant is not taking new orders right now.';
  }
  const wall = parseWall(deliveryTime);
  if (wall) {
    const now = laNowWall();
    const notice = Number(restaurant.min_notice_hours ?? 0);
    if (now && wall.epochMin - now.epochMin < notice * 60) {
      return `This restaurant needs at least ${notice} hour${notice === 1 ? '' : 's'} notice.`;
    }
    if (!isOpenAt(restaurant.business_hours, wall)) {
      return 'This restaurant is closed at that time.';
    }
  }
  const minOrder = Number(restaurant.min_order_amount || 0);
  if (minOrder > 0 && foodTotal != null && Number(foodTotal) < minOrder) {
    return `This restaurant's minimum order is $${minOrder.toFixed(2)}.`;
  }
  return null;
}

module.exports = { whyNot, isOpenAt, parseWall, laNowWall };
