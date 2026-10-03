-- 011 — catering extras, "food is on the way", birthday reminders (applied at server start)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS catering_options JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS on_the_way_at TIMESTAMPTZ;

-- Birthday Calendar: only a first name and month/day are kept (no year,
-- no phone, no email) so nothing sensitive about the friend is stored.
CREATE TABLE IF NOT EXISTS birthdays (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 31),
  last_reminded_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_birthdays_user_id ON birthdays(user_id);
