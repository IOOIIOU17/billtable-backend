/**
 * ============================================================
 * TigTagTrue Restaurant Service
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
 * Get a restaurant by ID for PUBLIC access (customer-facing).
 * Excludes soft-deleted restaurants, unlike getRestaurantById which
 * is used internally for owner/admin operations that may need to
 * access a restaurant even after it's been soft-deleted.
 */
async function getPublicRestaurantById(restaurantId) {
    const query = `
        SELECT *
        FROM restaurants
        WHERE id = $1 AND is_deleted = false
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
        minNoticeHours: 'min_notice_hours',
        minOrderAmount: 'min_order_amount',
        isActive: 'is_active',
        logoUrl: 'logo_url',
        coverImageUrl: 'cover_image_url',
        // Vibe profile (migration 012) — cleaned in the route
        vibeText: 'vibe_text',
        vibeTags: 'vibe_tags',
        bestFor: 'best_for',
        priceLevel: 'price_level',
        parkingType: 'parking_type',
        parkingNote: 'parking_note',
        // isDeleted intentionally NOT in this map anymore — permanent deletion
        // must go through requestRestaurantDeletion()/the grace-period flow
        // below, never a plain field-by-field PATCH. See migration 007.
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
        WHERE is_active = true AND is_deleted = false
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

// ============================================================
// Restaurant deletion — grace-period flow (checked 25 Sep 2026
// against UberEats/DoorDash: neither lets a restaurant vanish
// instantly and permanently with zero checks, so TigTagTrue
// doesn't either). See migration 007_restaurant_deletion.sql.
// ============================================================

const DELETION_GRACE_DAYS = 30;

// Any order in one of these statuses is still "in progress" — a
// restaurant can't request deletion while one exists, so nobody's
// active delivery or dine-in booking silently gets abandoned.
const UNRESOLVED_ORDER_STATUSES = ['pending', 'accepted', 'preparing', 'requested', 'confirmed'];

/**
 * Owner (or admin) asks to permanently remove a restaurant.
 * Blocks if there's an order still in progress. Otherwise closes
 * the restaurant to customers immediately (is_active = false) and
 * starts the DELETION_GRACE_DAYS countdown — it is NOT actually
 * deleted yet, so cancelRestaurantDeletion() can still undo it.
 */
async function requestRestaurantDeletion(restaurantId, requestedByUserId) {
    const restaurant = await getRestaurantById(restaurantId);
    if (!restaurant) throw new Error('Restaurant not found');
    if (restaurant.is_deleted) throw new Error('Restaurant is already deleted');

    const activeOrders = await db.query(
        `SELECT COUNT(*)::int AS count FROM orders
         WHERE restaurant_id = $1 AND status = ANY($2::text[])`,
        [restaurantId, UNRESOLVED_ORDER_STATUSES]
    );
    const count = activeOrders.rows[0]?.count || 0;
    if (count > 0) {
        throw new Error(`Cannot delete: ${count} order(s) still in progress. Resolve them first.`);
    }

    const result = await db.query(
        `UPDATE restaurants
         SET is_active = false, deletion_requested_at = NOW(), deletion_requested_by = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [restaurantId, requestedByUserId]
    );
    return result.rows[0];
}

/**
 * Cancel a pending deletion any time before the grace period ends.
 * Reopens the restaurant (is_active = true) since asking to cancel
 * implies wanting to keep operating.
 */
async function cancelRestaurantDeletion(restaurantId) {
    const result = await db.query(
        `UPDATE restaurants
         SET deletion_requested_at = NULL, deletion_requested_by = NULL, is_active = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND is_deleted = false
         RETURNING *`,
        [restaurantId]
    );
    if (result.rows.length === 0) throw new Error('Restaurant not found or already permanently deleted');
    return result.rows[0];
}

/**
 * Background sweep (called on an interval from server.js): finalizes
 * any restaurant whose grace period has fully elapsed.
 */
async function runPendingDeletionSweep() {
    const result = await db.query(
        `UPDATE restaurants
         SET is_deleted = true, updated_at = CURRENT_TIMESTAMP
         WHERE deletion_requested_at IS NOT NULL
           AND deletion_requested_at <= NOW() - INTERVAL '30 days'
           AND is_deleted = false
         RETURNING id, name`
    );
    if (result.rows.length > 0) {
        console.log('[restaurantService] Finalized deletions after grace period:', result.rows);
    }
    return result.rows;
}

// Export all public functions
module.exports = {
    registerRestaurant,
    getRestaurantById,
    getPublicRestaurantById,
    getRestaurantsByOwner,
    updateRestaurant,
    findNearbyRestaurants,
    setRestaurantActiveStatus,
    requestRestaurantDeletion,
    cancelRestaurantDeletion,
    runPendingDeletionSweep,
    DELETION_GRACE_DAYS,
};