-- Phase 3 / Feature 2 & 3 — Table Home: open ordering with attribution,
-- real Member roster, and Party Activities.
-- Run this once against the billtable database before using the new
-- /api/orders/:orderId/members, /items, /activities endpoints.

-- Tag each order_items row with who added it (host at checkout has NULL —
-- that's fine, existing rows stay untouched).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS added_by VARCHAR(100);

-- Which menu item this row came from, so the Food Sheet can show correct
-- +/- steppers per person. Only populated for items added via the new
-- open-ordering endpoint; older/checkout rows stay NULL.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS menu_item_id INT;

-- Roster — everyone at the table (host + guests who've joined).
CREATE TABLE IF NOT EXISTS order_members (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) DEFAULT 'guest',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Party agenda — "Cake cutting at 7:30 PM" etc.
CREATE TABLE IF NOT EXISTS order_activities (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  title VARCHAR(150) NOT NULL,
  time VARCHAR(100),
  created_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_members_order_id ON order_members(order_id);
CREATE INDEX IF NOT EXISTS idx_order_activities_order_id ON order_activities(order_id);
