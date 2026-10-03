-- 008 — Party access control (invite passcode) + chat moderation
-- Applied automatically at server start by services/partySchema.js
-- (every statement is IF NOT EXISTS, so re-running is safe).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS party_passcode VARCHAR(60);

ALTER TABLE order_members ADD COLUMN IF NOT EXISTS user_id INT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_order_members_order_user
  ON order_members(order_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS user_id INT;
ALTER TABLE order_messages ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS message_reports (
  id SERIAL PRIMARY KEY,
  message_id INT NOT NULL,
  order_id INT NOT NULL,
  reporter_user_id INT NOT NULL,
  reason VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_user_id INT NOT NULL,
  blocked_user_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);
