-- 009 — Customer "problem with my order" reports (applied at server start)
CREATE TABLE IF NOT EXISTS order_issues (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  issue_type VARCHAR(30) NOT NULL,
  message VARCHAR(1000),
  wants_refund BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  restaurant_reply VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_order_issues_order_id ON order_issues(order_id);
