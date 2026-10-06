-- 014 — party photos (applied at server start)
--   kind = 'cover'  : up to 3 photos the host adds to the top of Table Home
--   kind = 'memory' : the shared Memory album guests add to
-- Every photo is deleted (row + Cloudinary file) 24 hours after the party
-- ends; the party is treated as ended 6 hours after its start time, so the
-- delete time is delivery_time + 30 hours (LA time). See photoService.js.
CREATE TABLE IF NOT EXISTS party_photos (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('cover', 'memory')),
  url TEXT NOT NULL,
  public_id TEXT,
  uploader_name VARCHAR(80),
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  reported_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_party_photos_order ON party_photos(order_id, kind);
CREATE INDEX IF NOT EXISTS idx_party_photos_user ON party_photos(user_id);
