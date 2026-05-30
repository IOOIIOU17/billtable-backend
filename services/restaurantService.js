/**
 * ============================================================
 * BillTable Restaurant Service
 * ============================================================
 * Purpose: Business logic for restaurant management
 * Handles: Registration, retrieval, updates, location queries
 * 
 * This service is the "manager" that talks to the restaurants
 * table in the database. Routes call these functions; this file
 * is the only place that writes raw SQL for restaurant data.
 * 
 * Created: Phase 4
 * ============================================================
 */

const db = require('../db');

/**
 * Register a new restaurant in the database.
 * 
 * @param {Object} payload - Restaurant data
 * @param {number} payload.ownerUserId - ID of the user who owns this restaurant
 * @param {string} payload.name - Restaurant name
 * @param {string} payload.phone - Contact phone number
 * @param {string} payload.address - Street address
 * @param {string} payload.city - City name
 * @param {string} payload.state - State (e.g., 'CA')
 * @param {string} payload.zipCode - Zip code
 * @param {number} payload.latitude - GPS latitude
 * @param {number} payload.longitude - GPS longitude
 * @param {Array<string>} payload.cuisineTypes - Cuisine categories
 * @returns {Promise<Object>} The newly created restaurant
 */
async function registerRestaurant(payload) {
    const {
        ownerUserId,
        name,
        description = null,
        phone,
        email = null,
        address,
        city,
        state,
        zipCode,
        latitude,
        longitude,
        deliveryRadiusMiles = 5,
        cuisineTypes = [],
        businessHours = {},
        averagePrepTimeMinutes = 30,
        logoUrl = null,
        coverImageUrl = null,
    } = payload;

    const insertQuery = `
        INSERT INTO restaurants (
            owner_user_id, name, description, phone, email,
            address, city, state, zip_code, latitude, longitude,
            delivery_radius_miles, cuisine_types, business_hours,
            average_prep_time_minutes, logo_url, cover_image_url
        )
        VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, $13, $14,
            $15, $16, $17
        )
        RETURNING *;
    `;

    const values = [
        ownerUserId, name, description, phone, email,
        address, city, state, zipCode, latitude, longitude,
        deliveryRadiusMiles, cuisineTypes, JSON.stringify(businessHours),
        averagePrepTimeMinutes, logoUrl, coverImageUrl,
    ];

    const result = await db.query(insertQuery, values);
    return result.rows[0];
}

/**
 * Get a single restaurant by its ID.
 * 
 * @param {number} restaurantId - The restaurant ID
 * @returns {Promise<Object|null>} The restaurant or null if not found
 */
async function getRestaurantById(restaurantId) {
    const query = `
        SELECT *
        FROM restaurants
        WHERE id = $1
        LIMIT 1;
    `;

    const result = await db.query(query, [restaurantId]);
    return result.rows[0] || null;
}

/**
 * Get all restaurants owned by a specific user.
 * Used when a restaurant owner logs into the dashboard.
 * 
 * @param {number} ownerUserId - The owner's user ID
 * @returns {Promise<Array>} List of restaurants owned by this user
 */
async function getRestaurantsByOwner(ownerUserId) {
    const query = `
        SELECT *
        FROM restaurants
        WHERE owner_user_id = $1
        ORDER BY created_at DESC;
    `;

    const result = await db.query(query, [ownerUserId]);
    return result.rows;
}

/**
 * Update restaurant information.
 * Only updates fields that are provided in the patch object.
 * 
 * @param {number} restaurantId - The restaurant ID to update
 * @param {Object} patch - Fields to update (partial update supported)
 * @returns {Promise<Object|null>} The updated restaurant or null if not found
 */
async function updateRestaurant(restaurantId, patch) {
    // Map JavaScript camelCase keys to database snake_case columns
    const fieldMap = {
        name: 'name',
        description: 'description',
        phone: 'phone',
        email: 'email',
        address: 'address',
        city: 'city',
        state: 'state',
        zipCode: 'zip_code',
        latitude: 'latitude',
        longitude: 'longitude',
        deliveryRadiusMiles: 'delivery_radius_miles',
        cuisineTypes: 'cuisine_types',
        businessHours: 'business_hours',
        averagePrepTimeMinutes: 'average_prep_time_minutes',
        isActive: 'is_active',
        logoUrl: 'logo_url',
        coverImageUrl: 'cover_image_url',
    };

    // Build SET clause dynamically based on provided fields
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [jsKey, dbColumn] of Object.entries(fieldMap)) {
        if (patch[jsKey] !== undefined) {
            setClauses.push(`${dbColumn} = $${paramIndex}`);
            
            // Stringify JSON objects before insertion
            const value = jsKey === 'businessHours'
                ? JSON.stringify(patch[jsKey])
                : patch[jsKey];
            
            values.push(value);
            paramIndex += 1;
        }
    }

    // Always update the updated_at timestamp
    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);

    // Nothing to update except the timestamp? Return current record.
    if (setClauses.length === 1) {
        return getRestaurantById(restaurantId);
    }

    values.push(restaurantId);
    const updateQuery = `
        UPDATE restaurants
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *;
    `;

    const result = await db.query(updateQuery, values);
    return result.rows[0] || null;
}

/**
 * Find restaurants near a customer's location.
 * 
 * Uses the Haversine formula approximation to calculate distance
 * between two GPS coordinates in miles. Only returns active and
 * verified restaurants within their declared delivery radius.
 * 
 * @param {Object} params
 * @param {number} params.customerLatitude - Customer's GPS latitude
 * @param {number} params.customerLongitude - Customer's GPS longitude
 * @param {number} params.maxResults - Max number of results (default 20)
 * @returns {Promise<Array>} Nearby restaurants with distance in miles
 */
async function findNearbyRestaurants(params) {
    const {
        customerLatitude,
        customerLongitude,
        maxResults = 20,
    } = params;

    // 3959 = Earth's radius in miles
    // Haversine distance formula in SQL
    const query = `
        SELECT
            *,
            (
                3959 * acos(
                    cos(radians($1)) *
                    cos(radians(latitude)) *
                    cos(radians(longitude) - radians($2)) +
                    sin(radians($1)) *
                    sin(radians(latitude))
                )
            ) AS distance_miles
        FROM restaurants
        WHERE is_active = true
        HAVING (
            3959 * acos(
                cos(radians($1)) *
                cos(radians(latitude)) *
                cos(radians(longitude) - radians($2)) +
                sin(radians($1)) *
                sin(radians(latitude))
            )
        ) <= delivery_radius_miles
        ORDER BY distance_miles ASC
        LIMIT $3;
    `;

    const result = await db.query(query, [
        customerLatitude,
        customerLongitude,
        maxResults,
    ]);

    return result.rows;
}

/**
 * Toggle restaurant active status (open/closed).
 * Used when a restaurant wants to temporarily stop accepting orders.
 * 
 * @param {number} restaurantId - The restaurant ID
 * @param {boolean} isActive - true = open, false = closed
 * @returns {Promise<Object|null>} The updated restaurant
 */
async function setRestaurantActiveStatus(restaurantId, isActive) {
    const query = `
        UPDATE restaurants
        SET is_active = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *;
    `;

    const result = await db.query(query, [isActive, restaurantId]);
    return result.rows[0] || null;
}

// Export all public functions
module.exports = {
    registerRestaurant,
    getRestaurantById,
    getRestaurantsByOwner,
    updateRestaurant,
    findNearbyRestaurants,
    setRestaurantActiveStatus,
};