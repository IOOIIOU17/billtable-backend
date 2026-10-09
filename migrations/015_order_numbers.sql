-- TigTagTrue Migration 015: invoice-style order numbers (TT-2026-000001).
-- One running counter per LA calendar year. Idempotent; runs on every boot.
CREATE TABLE IF NOT EXISTS order_number_counters (
  year       INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL
);
