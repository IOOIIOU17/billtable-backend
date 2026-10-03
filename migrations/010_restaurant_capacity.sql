-- 010 — Restaurant capacity rules (applied at server start)
-- busy_until: "pause new orders" until this time (busy mode)
-- min_notice_hours: how far ahead a catering order must be placed
-- min_order_amount: smallest food total the restaurant will take
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS busy_until TIMESTAMPTZ;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS min_notice_hours INT DEFAULT 2;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS min_order_amount NUMERIC(10,2) DEFAULT 0;
