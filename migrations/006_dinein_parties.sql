-- 006_dinein_parties.sql
-- Dine-in party booking (IDEA 1)
-- Additive only: no existing column is altered or dropped.
-- Every new column has a default so the 152 existing orders keep working unchanged.

BEGIN;

-- ─── restaurants: order-type switches + dine-in settings ───────────────
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS accepts_delivery  BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS accepts_dinein    BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deposit_percent   NUMERIC(5,2) NOT NULL DEFAULT 25.00,
  ADD COLUMN IF NOT EXISTS parking_type      VARCHAR(32),
  ADD COLUMN IF NOT EXISTS parking_note      TEXT,
  ADD COLUMN IF NOT EXISTS max_party_size    INTEGER,
  ADD COLUMN IF NOT EXISTS min_advance_hours INTEGER      NOT NULL DEFAULT 24;

-- Deposit must always cover the 10% platform cut, so 15% is the floor.
ALTER TABLE restaurants
  DROP CONSTRAINT IF EXISTS restaurants_deposit_percent_range;
ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_deposit_percent_range
  CHECK (deposit_percent >= 15.00 AND deposit_percent <= 50.00);

-- ─── dinein_packages: the per-head price the restaurant sets itself ────
CREATE TABLE IF NOT EXISTS dinein_packages (
  id               SERIAL PRIMARY KEY,
  restaurant_id    INTEGER        NOT NULL REFERENCES restaurants(id),
  name             VARCHAR(120)   NOT NULL,
  price_per_person NUMERIC(10,2)  NOT NULL CHECK (price_per_person > 0),
  min_guests       INTEGER        NOT NULL DEFAULT 4,
  max_guests       INTEGER,
  included_items   TEXT,
  is_active        BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dinein_packages_restaurant
  ON dinein_packages(restaurant_id) WHERE is_active = TRUE;

-- ─── orders: dine-in fields (delivery orders are untouched) ────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_mode       VARCHAR(16)  NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS package_id       INTEGER      REFERENCES dinein_packages(id),
  ADD COLUMN IF NOT EXISTS party_size       INTEGER,
  ADD COLUMN IF NOT EXISTS reserved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS neighborhood     VARCHAR(120),
  ADD COLUMN IF NOT EXISTS booking_total    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_percent  NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS deposit_amount   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_status   VARCHAR(24)  NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS payout_status    VARCHAR(24)  NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reschedule_count INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_by     VARCHAR(16),
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS table_closed_at  TIMESTAMPTZ;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_mode_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_mode_check
  CHECK (order_mode IN ('delivery','dinein'));

CREATE INDEX IF NOT EXISTS idx_orders_mode_reserved
  ON orders(order_mode, reserved_at) WHERE order_mode = 'dinein';

-- ─── order_members: link a seat to a real account (nullable, unused yet)
ALTER TABLE order_members
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

-- ─── restaurant_agreements: clickwrap record ───────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_agreements (
  id                SERIAL PRIMARY KEY,
  restaurant_id     INTEGER      NOT NULL REFERENCES restaurants(id),
  user_id           INTEGER      NOT NULL REFERENCES users(id),
  agreement_type    VARCHAR(32)  NOT NULL,
  agreement_version VARCHAR(16)  NOT NULL,
  accepted_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip_address        VARCHAR(64),
  user_agent        TEXT
);
CREATE INDEX IF NOT EXISTS idx_agreements_restaurant
  ON restaurant_agreements(restaurant_id, agreement_type);

-- ─── platform settings for dine-in ─────────────────────────────────────
INSERT INTO platform_settings (key, value) VALUES
  ('dinein_free_cancel_days',   '7'),
  ('dinein_forfeit_hours',      '72'),
  ('dinein_reschedule_hours',   '72'),
  ('dinein_agreement_version',  'v1.0'),
  ('dinein_autocomplete_hours', '24')
ON CONFLICT (key) DO NOTHING;

COMMIT;
