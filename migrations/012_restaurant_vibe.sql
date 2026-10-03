-- 012 — restaurant "vibe" profile for Browse + matching (applied at server start)
-- Storefront photo reuses restaurants.cover_image_url; parking reuses
-- parking_type / parking_note from 006.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS vibe_text TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS vibe_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS best_for TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS price_level SMALLINT;
ALTER TABLE restaurants DROP CONSTRAINT IF EXISTS restaurants_price_level_range;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_price_level_range
  CHECK (price_level IS NULL OR price_level BETWEEN 1 AND 4);
