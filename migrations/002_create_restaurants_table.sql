-- ============================================================
-- BillTable Migration 002: Create Restaurants Table
-- Purpose: Store restaurant profiles for AI matching
-- Created: Phase 4
-- ============================================================

CREATE TABLE IF NOT EXISTS restaurants (
    id SERIAL PRIMARY KEY,
    
    -- Link to the user who owns this restaurant
    owner_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Restaurant identity
    name VARCHAR(255) NOT NULL,
    description TEXT,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    
    -- Restaurant location for AI matching
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(50) NOT NULL,
    zip_code VARCHAR(20) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    
    -- How far this restaurant delivers (in miles)
    delivery_radius_miles INT NOT NULL DEFAULT 5,
    
    -- What cuisine types this restaurant serves
    -- Stored as array: e.g. ['thai', 'chinese'] or ['sushi']
    cuisine_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    
    -- Operating hours stored as JSON for flexibility
    -- Example: {"monday": {"open": "09:00", "close": "21:00"}}
    business_hours JSONB DEFAULT '{}'::jsonb,
    
    -- Average time to prepare food (for delivery time estimation)
    average_prep_time_minutes INT DEFAULT 30,
    
    -- Status flags
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    
    -- Restaurant images
    logo_url VARCHAR(500),
    cover_image_url VARCHAR(500),
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster searching
CREATE INDEX idx_restaurants_owner_user_id ON restaurants(owner_user_id);
CREATE INDEX idx_restaurants_location ON restaurants(latitude, longitude);
CREATE INDEX idx_restaurants_city ON restaurants(city);
CREATE INDEX idx_restaurants_is_active ON restaurants(is_active);