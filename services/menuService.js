/**
 * ============================================================
 * BillTable Menu Service
 * ============================================================
 * Purpose: Business logic for menu item management
 * Handles: CRUD operations + AI-driven filtering for matching
 * 
 * This service is the "menu manager" that talks to the menus
 * table in the database. Routes call these functions; this file
 * is the only place that writes raw SQL for menu data.
 * 
 * Created: Phase 4
 * ============================================================
 */

const db = require('../db');

/**
 * Add a single menu item to a restaurant.
 * 
 * @param {Object} payload - Menu item data
 * @param {number} payload.restaurantId - ID of the restaurant
 * @param {string} payload.name - Menu item name
 * @param {number} payload.price - Price in USD
 * @param {string} payload.cuisineType - Cuisine category
 * @returns {Promise<Object>} The newly created menu item
 */
async function addMenuItem(payload) {
    const {
        restaurantId,
        name,
        description = null,
        price,
        cuisineType,
        category = 'main',
        spicyLevel = 0,
        allergens = [],
        dietaryTags = [],
        servingSize = 1,
        imageUrl = null,
        displayOrder = 100,
    } = payload;

    const insertQuery = `
        INSERT INTO menus (
            restaurant_id, name, description, price,
            cuisine_type, category, spicy_level,
            allergens, dietary_tags, serving_size,
            image_url, display_order
        )
        VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, $12
        )
        RETURNING *;
    `;

    const values = [
        restaurantId, name, description, price,
        cuisineType || 'general', category, spicyLevel || 0,
        allergens || [], dietaryTags || [], servingSize || 1,
        imageUrl, displayOrder,
    ];

    const result = await db.query(insertQuery, values);
    return result.rows[0];
}

/**
 * Add multiple menu items in a single transaction.
 * Used when a restaurant uploads a CSV with their entire menu.
 * If any item fails, the entire batch is rolled back.
 * 
 * @param {number} restaurantId - The restaurant to add items to
 * @param {Array<Object>} items - Array of menu items
 * @returns {Promise<Object>} Result with insertedCount and items
 */
async function bulkAddMenuItems(restaurantId, items) {
    if (!Array.isArray(items) || items.length === 0) {
        return { insertedCount: 0, items: [] };
    }

    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        const insertedItems = [];
        
        for (const item of items) {
            const payload = { ...item, restaurantId };
            
            const {
                name,
                description = null,
                price,
                cuisineType,
                category = 'main',
                spicyLevel = 0,
                allergens = [],
                dietaryTags = [],
                servingSize = 1,
                imageUrl = null,
                displayOrder = 100,
            } = payload;

            const insertQuery = `
                INSERT INTO menus (
                    restaurant_id, name, description, price,
                    cuisine_type, category, spicy_level,
                    allergens, dietary_tags, serving_size,
                    image_url, display_order
                )
                VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7,
                    $8, $9, $10,
                    $11, $12
                )
                RETURNING *;
            `;

            const result = await client.query(insertQuery, [
                restaurantId, name, description, price,
                cuisineType, category, spicyLevel,
                allergens || [], dietaryTags || [], servingSize || 1,
                imageUrl, displayOrder,
            ]);
            
            insertedItems.push(result.rows[0]);
        }
        
        await client.query('COMMIT');
        
        return {
            insertedCount: insertedItems.length,
            items: insertedItems,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get a single menu item by ID.
 * 
 * @param {number} menuItemId - The menu item ID
 * @returns {Promise<Object|null>} The menu item or null
 */
async function getMenuItemById(menuItemId) {
    const query = `
        SELECT *
        FROM menus
        WHERE id = $1
        LIMIT 1;
    `;

    const result = await db.query(query, [menuItemId]);
    return result.rows[0] || null;
}

/**
 * Get all menu items for a specific restaurant.
 * Returned items are sorted by display_order, then by name.
 * 
 * @param {number} restaurantId - The restaurant ID
 * @param {Object} options - Filtering options
 * @param {boolean} options.availableOnly - Show only available items
 * @returns {Promise<Array>} List of menu items
 */
async function getMenuByRestaurant(restaurantId, options = {}) {
    const { availableOnly = false } = options;

    let query = `
        SELECT *
        FROM menus
        WHERE restaurant_id = $1
    `;

    if (availableOnly) {
        query += ` AND is_available = true`;
    }

    query += `
        ORDER BY display_order ASC, name ASC;
    `;

    const result = await db.query(query, [restaurantId]);
    return result.rows;
}

/**
 * Search menu items across all restaurants based on filters.
 * 
 * This is the function used by the AI matching service. It filters
 * menu items by cuisine type and budget, then excludes items that
 * contain any allergens the customer is sensitive to.
 * 
 * @param {Object} filters
 * @param {string} filters.cuisineType - Required cuisine (e.g., 'thai')
 * @param {number} filters.maxPrice - Maximum price per item
 * @param {Array<string>} filters.excludeAllergens - Allergens to avoid
 * @param {number} filters.maxSpicyLevel - Max acceptable spicy level (0-5)
 * @param {Array<number>} filters.restaurantIds - Limit to specific restaurants
 * @param {number} filters.limit - Max results (default 50)
 * @returns {Promise<Array>} Matching menu items
 */
async function searchMenuItems(filters) {
    const {
        cuisineType = null,
        maxPrice = null,
        excludeAllergens = [],
        maxSpicyLevel = null,
        restaurantIds = null,
        limit = 50,
    } = filters;

    const conditions = ['is_available = true'];
    const values = [];
    let paramIndex = 1;

    if (cuisineType) {
        conditions.push(`cuisine_type = $${paramIndex}`);
        values.push(cuisineType);
        paramIndex += 1;
    }

    if (maxPrice !== null) {
        conditions.push(`price <= $${paramIndex}`);
        values.push(maxPrice);
        paramIndex += 1;
    }

    if (maxSpicyLevel !== null) {
        conditions.push(`spicy_level <= $${paramIndex}`);
        values.push(maxSpicyLevel);
        paramIndex += 1;
    }

    // Exclude items that contain any of the customer's allergens
    if (excludeAllergens.length > 0) {
        conditions.push(`NOT (allergens && $${paramIndex}::TEXT[])`);
        values.push(excludeAllergens);
        paramIndex += 1;
    }

    // Limit to specific restaurants (from nearby search)
    if (restaurantIds && restaurantIds.length > 0) {
        conditions.push(`restaurant_id = ANY($${paramIndex}::INT[])`);
        values.push(restaurantIds);
        paramIndex += 1;
    }

    values.push(limit);
    const query = `
        SELECT *
        FROM menus
        WHERE ${conditions.join(' AND ')}
        ORDER BY price ASC, name ASC
        LIMIT $${paramIndex};
    `;

    const result = await db.query(query, values);
    return result.rows;
}

/**
 * Update a menu item.
 * Only updates fields that are provided in the patch object.
 * 
 * @param {number} menuItemId - Menu item ID to update
 * @param {Object} patch - Fields to update
 * @returns {Promise<Object|null>} The updated item or null
 */
async function updateMenuItem(menuItemId, patch) {
    const fieldMap = {
        name: 'name',
        description: 'description',
        price: 'price',
        cuisineType: 'cuisine_type',
        category: 'category',
        spicyLevel: 'spicy_level',
        allergens: 'allergens',
        dietaryTags: 'dietary_tags',
        servingSize: 'serving_size',
        isAvailable: 'is_available',
        imageUrl: 'image_url',
        displayOrder: 'display_order',
    };

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [jsKey, dbColumn] of Object.entries(fieldMap)) {
        if (patch[jsKey] !== undefined) {
            setClauses.push(`${dbColumn} = $${paramIndex}`);
            values.push(patch[jsKey]);
            paramIndex += 1;
        }
    }

    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);

    if (setClauses.length === 1) {
        return getMenuItemById(menuItemId);
    }

    values.push(menuItemId);
    const updateQuery = `
        UPDATE menus
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *;
    `;

    const result = await db.query(updateQuery, values);
    return result.rows[0] || null;
}

/**
 * Delete a menu item permanently.
 * 
 * @param {number} menuItemId - The menu item ID to delete
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
async function deleteMenuItem(menuItemId) {
    const query = `
        DELETE FROM menus
        WHERE id = $1
        RETURNING id;
    `;

    const result = await db.query(query, [menuItemId]);
    return result.rowCount > 0;
}

/**
 * Toggle menu item availability (sold out vs available).
 * Faster than updateMenuItem when only flipping one flag.
 * 
 * @param {number} menuItemId - Menu item ID
 * @param {boolean} isAvailable - true = available, false = sold out
 * @returns {Promise<Object|null>} The updated item
 */
async function setMenuItemAvailability(menuItemId, isAvailable) {
    const query = `
        UPDATE menus
        SET is_available = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *;
    `;

    const result = await db.query(query, [isAvailable, menuItemId]);
    return result.rows[0] || null;
}

// Export all public functions
module.exports = {
    addMenuItem,
    bulkAddMenuItems,
    getMenuItemById,
    getMenuByRestaurant,
    searchMenuItems,
    updateMenuItem,
    deleteMenuItem,
    setMenuItemAvailability,
};