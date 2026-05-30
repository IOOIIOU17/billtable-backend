/**
 * ============================================================
 * BillTable Menu Routes
 * ============================================================
 * Purpose: HTTP endpoints for menu item operations
 * Handles: CRUD operations + AI-driven menu search
 * 
 * This file is the "receptionist" that answers HTTP calls about
 * menu items. It validates input, checks ownership, then delegates
 * to menuService.js for all data operations.
 * 
 * Mounted at: /api/menus
 * Created: Phase 4
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const menuService = require('../services/menuService');
const restaurantService = require('../services/restaurantService');
const { authenticateToken } = require('../middleware/auth');

/**
 * Helper: Verify the logged-in user owns the restaurant.
 * Returns the restaurant if owned, throws error otherwise.
 */
async function verifyRestaurantOwnership(restaurantId, userId) {
    const restaurant = await restaurantService.getRestaurantById(restaurantId);
    
    if (!restaurant) {
        const error = new Error('Restaurant not found');
        error.statusCode = 404;
        throw error;
    }
    
    if (restaurant.owner_user_id !== userId) {
        const error = new Error('You do not own this restaurant');
        error.statusCode = 403;
        throw error;
    }
    
    return restaurant;
}

/**
 * POST /api/menus
 * Add a single menu item to a restaurant.
 * Owner of the restaurant must be logged in.
 * 
 * Request body example:
 * {
 *   "restaurantId": 1,
 *   "name": "Pad Thai with Shrimp",
 *   "price": 14.99,
 *   "cuisineType": "thai",
 *   "spicyLevel": 2,
 *   "allergens": ["shellfish", "peanut"]
 * }
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            restaurantId,
            name,
            price,
            cuisineType,
        } = req.body;

        // Required field validation
        const missingFields = [];
        if (!restaurantId) missingFields.push('restaurantId');
        if (!name) missingFields.push('name');
        if (price === undefined) missingFields.push('price');
        if (!cuisineType) missingFields.push('cuisineType');

        if (missingFields.length > 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                missingFields,
            });
        }

        if (price < 0) {
            return res.status(400).json({ error: 'Price cannot be negative' });
        }

        // Ownership check
        await verifyRestaurantOwnership(restaurantId, userId);

        const newItem = await menuService.addMenuItem(req.body);

        return res.status(201).json({
            message: 'Menu item added successfully',
            menuItem: newItem,
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Error adding menu item:', error);
        return res.status(500).json({ error: 'Failed to add menu item' });
    }
});

/**
 * POST /api/menus/bulk
 * Add multiple menu items at once.
 * Used when a restaurant uploads a CSV with their entire menu.
 * 
 * Request body example:
 * {
 *   "restaurantId": 1,
 *   "items": [
 *     { "name": "Pad Thai", "price": 12, "cuisineType": "thai" },
 *     { "name": "Green Curry", "price": 14, "cuisineType": "thai" }
 *   ]
 * }
 */
router.post('/bulk', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { restaurantId, items } = req.body;

        if (!restaurantId) {
            return res.status(400).json({ error: 'restaurantId is required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                error: 'items must be a non-empty array',
            });
        }

        // Ownership check
        await verifyRestaurantOwnership(restaurantId, userId);

        const result = await menuService.bulkAddMenuItems(restaurantId, items);

        return res.status(201).json({
            message: `${result.insertedCount} menu items added successfully`,
            ...result,
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Error bulk adding menu items:', error);
        return res.status(500).json({ error: 'Failed to add menu items' });
    }
});

/**
 * GET /api/menus/restaurant/:restaurantId
 * Get all menu items for a specific restaurant.
 * Public endpoint — used when customer browses restaurant menu.
 * 
 * Query parameter:
 *   ?availableOnly=true  (only show available items)
 */
router.get('/restaurant/:restaurantId', async (req, res) => {
    try {
        const restaurantId = parseInt(req.params.restaurantId, 10);
        const availableOnly = req.query.availableOnly === 'true';

        if (isNaN(restaurantId)) {
            return res.status(400).json({ error: 'Invalid restaurant ID' });
        }

        const menuItems = await menuService.getMenuByRestaurant(restaurantId, {
            availableOnly,
        });

        return res.status(200).json({
            count: menuItems.length,
            menuItems,
        });
    } catch (error) {
        console.error('Error fetching menu:', error);
        return res.status(500).json({ error: 'Failed to fetch menu' });
    }
});

/**
 * GET /api/menus/:menuItemId
 * Get a single menu item by ID.
 * Public endpoint.
 */
router.get('/:menuItemId', async (req, res) => {
    try {
        const menuItemId = parseInt(req.params.menuItemId, 10);

        if (isNaN(menuItemId)) {
            return res.status(400).json({ error: 'Invalid menu item ID' });
        }

        const item = await menuService.getMenuItemById(menuItemId);

        if (!item) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        return res.status(200).json({ menuItem: item });
    } catch (error) {
        console.error('Error fetching menu item:', error);
        return res.status(500).json({ error: 'Failed to fetch menu item' });
    }
});

/**
 * PATCH /api/menus/:menuItemId
 * Update a menu item.
 * Requires authentication AND ownership of the parent restaurant.
 */
router.patch('/:menuItemId', authenticateToken, async (req, res) => {
    try {
        const menuItemId = parseInt(req.params.menuItemId, 10);
        const userId = req.user.userId;

        if (isNaN(menuItemId)) {
            return res.status(400).json({ error: 'Invalid menu item ID' });
        }

        const existing = await menuService.getMenuItemById(menuItemId);
        if (!existing) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        // Ownership check via parent restaurant
        await verifyRestaurantOwnership(existing.restaurant_id, userId);

        const updated = await menuService.updateMenuItem(menuItemId, req.body);

        return res.status(200).json({
            message: 'Menu item updated successfully',
            menuItem: updated,
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Error updating menu item:', error);
        return res.status(500).json({ error: 'Failed to update menu item' });
    }
});

/**
 * PATCH /api/menus/:menuItemId/availability
 * Toggle menu item availability (sold out vs available).
 * Faster than the full PATCH when only flipping is_available.
 * 
 * Request body: { "isAvailable": true } or { "isAvailable": false }
 */
router.patch('/:menuItemId/availability', authenticateToken, async (req, res) => {
    try {
        const menuItemId = parseInt(req.params.menuItemId, 10);
        const userId = req.user.userId;
        const { isAvailable } = req.body;

        if (isNaN(menuItemId)) {
            return res.status(400).json({ error: 'Invalid menu item ID' });
        }

        if (typeof isAvailable !== 'boolean') {
            return res.status(400).json({
                error: 'isAvailable must be true or false',
            });
        }

        const existing = await menuService.getMenuItemById(menuItemId);
        if (!existing) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        // Ownership check
        await verifyRestaurantOwnership(existing.restaurant_id, userId);

        const updated = await menuService.setMenuItemAvailability(
            menuItemId,
            isAvailable,
        );

        return res.status(200).json({
            message: `Menu item is now ${isAvailable ? 'available' : 'sold out'}`,
            menuItem: updated,
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Error toggling availability:', error);
        return res.status(500).json({ error: 'Failed to update availability' });
    }
});

/**
 * DELETE /api/menus/:menuItemId
 * Permanently delete a menu item.
 * Requires authentication AND ownership.
 */
router.delete('/:menuItemId', authenticateToken, async (req, res) => {
    try {
        const menuItemId = parseInt(req.params.menuItemId, 10);
        const userId = req.user.userId;

        if (isNaN(menuItemId)) {
            return res.status(400).json({ error: 'Invalid menu item ID' });
        }

        const existing = await menuService.getMenuItemById(menuItemId);
        if (!existing) {
            return res.status(404).json({ error: 'Menu item not found' });
        }

        // Ownership check
        await verifyRestaurantOwnership(existing.restaurant_id, userId);

        const deleted = await menuService.deleteMenuItem(menuItemId);

        if (!deleted) {
            return res.status(500).json({ error: 'Failed to delete menu item' });
        }

        return res.status(200).json({
            message: 'Menu item deleted successfully',
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error('Error deleting menu item:', error);
        return res.status(500).json({ error: 'Failed to delete menu item' });
    }
});

/**
 * POST /api/menus/search
 * Search menu items across restaurants with filters.
 * Used by the AI matching service.
 * Public endpoint.
 * 
 * Request body example:
 * {
 *   "cuisineType": "thai",
 *   "maxPrice": 20,
 *   "maxSpicyLevel": 3,
 *   "excludeAllergens": ["peanut", "shellfish"],
 *   "restaurantIds": [1, 2, 5],
 *   "limit": 30
 * }
 */
router.post('/search', async (req, res) => {
    try {
        const results = await menuService.searchMenuItems(req.body);

        return res.status(200).json({
            count: results.length,
            menuItems: results,
        });
    } catch (error) {
        console.error('Error searching menu:', error);
        return res.status(500).json({ error: 'Failed to search menu' });
    }
});

module.exports = router;