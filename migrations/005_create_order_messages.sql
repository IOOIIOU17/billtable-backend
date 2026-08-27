-- Phase — Real Table Chat. Replaces the "Chat is coming soon." placeholder
-- with real messages stored per order, polled by the client every few
-- seconds while the Chat panel is open (no WebSocket infra needed).
-- Run this once against the billtable database before using the new
-- /api/orders/:orderId/messages endpoints.

CREATE TABLE IF NOT EXISTS order_messages (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  sender_name VARCHAR(100) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_messages_order_id ON order_messages(order_id);
