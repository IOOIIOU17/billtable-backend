-- ============================================================
-- BillTable Migration 003: Create Menus Table
-- Purpose: Store menu items for each restaurant
-- Used by: AI matching service + customer menu browser
-- Created: Phase 4
-- ============================================================

CREATE TABLE IF NOT EXISTS menus (
    id SERIAL PRIMARY KEY,
    
    -- Link to the restaurant that owns this menu item
    restaurant_id INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Menu item identity
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Pricing in USD (supports up to $99,999.99 per item)
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    
    -- Categorization for AI matching
    -- Examples: 'thai', 'sushi', 'pizza', 'dessert', 'beverage'
    cuisine_type VARCHAR(50) NOT NULL,
    
    -- Sub-category within cuisine
    -- Examples: 'appetizer', 'main', 'dessert', 'soup', 'salad'
    category VARCHAR(50) DEFAULT 'main',
    
    -- Spicy level scale (0 = not spicy, 5 = extremely spicy)
    -- Used by AI to match customer taste preferences
    spicy_level INT DEFAULT 0 CHECK (spicy_level BETWEEN 0 AND 5),
    
    -- Allergen warnings stored as array
    -- Examples: ['nuts', 'shellfish', 'dairy', 'gluten', 'egg', 'soy']
    -- Used by AI to filter out items that conflict with customer allergies
    allergens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    
    -- Dietary tags for filtering
    -- Examples: ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten-free']
    dietary_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    
    -- How many people one serving feeds (for catering orders)
    serving_size INT DEFAULT 1 CHECK (serving_size > 0),
    
    -- Menu item availability
    is_available BOOLEAN NOT NULL DEFAULT true,
    
    -- Item image
    image_url VARCHAR(500),
    
    -- Sort order on restaurant menu page (lower number = shown first)
    display_order INT DEFAULT 100,
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast searching by AI matching service
CREATE INDEX idx_menus_restaurant_id ON menus(restaurant_id);
CREATE INDEX idx_menus_cuisine_type ON menus(cuisine_type);
CREATE INDEX idx_menus_is_available ON menus(is_available);
CREATE INDEX idx_menus_price ON menus(price);