-- 013 — indexes for the busiest lookups (applied at server start).
-- The original orders / order_items tables were created by hand, so these
-- may already exist under other names; IF NOT EXISTS keeps it safe.
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id ON orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_members_user_id ON order_members(user_id);
CREATE INDEX IF NOT EXISTS idx_order_messages_order_id_id ON order_messages(order_id, id);
CREATE INDEX IF NOT EXISTS idx_menus_restaurant_available ON menus(restaurant_id, is_available);
