const pool = require('../db');
const { logger } = require('../middleware/logger');
const { pushToCustomer } = require('./pushService');
const { laNowWall } = require('../utils/availability');

// Birthday Calendar (Tony's idea): save friends' birthdays, get a nudge
// 7 days and 1 day before, so planning a table starts in time.
async function listBirthdays(userId) {
  const r = await pool.query('SELECT id, name, month, day FROM birthdays WHERE user_id = $1 ORDER BY month, day, name', [userId]);
  return r.rows;
}

async function addBirthday(userId, { name, month, day }) {
  const n = String(name || '').trim().slice(0, 60);
  const m = Number(month);
  const d = Number(day);
  if (!n) throw new Error('Add a name.');
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (!Number.isInteger(m) || !maxDay || !Number.isInteger(d) || d < 1 || d > maxDay) throw new Error('Pick a real date.');
  const count = await pool.query('SELECT COUNT(*)::int AS c FROM birthdays WHERE user_id = $1', [userId]);
  if (count.rows[0].c >= 200) throw new Error('You can save up to 200 birthdays.');
  const r = await pool.query(
    'INSERT INTO birthdays (user_id, name, month, day) VALUES ($1, $2, $3, $4) RETURNING id, name, month, day',
    [userId, n, m, d]
  );
  return r.rows[0];
}

async function deleteBirthday(userId, id) {
  await pool.query('DELETE FROM birthdays WHERE id = $1 AND user_id = $2', [id, userId]);
}

// Runs every hour; sends at most one reminder per birthday per day, only
// from 9am LA time so nobody gets a 2am buzz.
async function runBirthdayReminders() {
  try {
    const now = laNowWall();
    if (!now || Math.floor(now.minutes / 60) < 9) return;
    const today = `${now.y}-${String(now.mo).padStart(2, '0')}-${String(now.d).padStart(2, '0')}`;
    const r = await pool.query(
      `SELECT b.id, b.user_id, b.name,
              (make_date(EXTRACT(YEAR FROM $1::date)::int, b.month, LEAST(b.day, 28)) + (b.day - LEAST(b.day, 28)) * INTERVAL '1 day')::date AS this_year
         FROM birthdays b
        WHERE b.last_reminded_on IS DISTINCT FROM $1::date`,
      [today]
    );
    const todayMs = Date.UTC(now.y, now.mo - 1, now.d);
    for (const b of r.rows) {
      let bd = new Date(b.this_year);
      let diff = Math.round((Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth(), bd.getUTCDate()) - todayMs) / 86400000);
      if (diff < 0) diff += 365;
      if (diff !== 7 && diff !== 1) continue;
      await pushToCustomer(b.user_id, {
        type: 'birthday',
        title: diff === 7 ? `${b.name}'s birthday is in a week` : `${b.name}'s birthday is tomorrow`,
        body: 'Want to set a table for it? Open BillTable to plan the party.',
      }).catch(() => {});
      await pool.query('UPDATE birthdays SET last_reminded_on = $1::date WHERE id = $2', [today, b.id]);
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Birthday reminders failed');
  }
}

module.exports = { listBirthdays, addBirthday, deleteBirthday, runBirthdayReminders };
