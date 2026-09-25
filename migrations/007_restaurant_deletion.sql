-- 007_restaurant_deletion.sql
-- Restaurant self-deletion, with a grace period instead of instant
-- permanent removal — matches how UberEats/DoorDash handle this
-- (checked 25 Sep 2026: neither platform lets a restaurant vanish
-- instantly and permanently with no checks; UberEats's own business
-- account deactivation is self-service but has a 60-day recoverable
-- window first, and DoorDash requires going through Merchant Support
-- for a permanent removal).
--
-- Flow:
--   1. Owner (or admin) calls POST /:restaurantId/request-deletion.
--      Blocked if the restaurant has any order still in progress.
--      Otherwise: is_active = false, deletion_requested_at = NOW().
--   2. Anyone can call POST /:restaurantId/cancel-deletion any time
--      before the grace period ends, to change their mind.
--   3. A background sweep (runPendingDeletionSweep in
--      restaurantService.js, run every 6h from server.js) sets
--      is_deleted = true once DELETION_GRACE_DAYS have passed.
--
-- Additive only: no existing column is altered or dropped.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_requested_by INTEGER REFERENCES users(id);
