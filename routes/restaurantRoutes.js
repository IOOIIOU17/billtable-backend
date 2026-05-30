/**
 * ============================================================
 * BillTable Restaurant Routes
 * ============================================================
 * Purpose: HTTP endpoints for restaurant operations
 * Handles: Receives requests, validates input, calls service,
 *          returns JSON response
 * 
 * This file is the "receptionist" that answers HTTP calls from
 * the customer app and restaurant app. It never writes SQL —
 * it always delegates to restaurantService.js for that.
 * 
 * Mounted at: /api/restaurants
 * Created: Phase 4
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const restaurantService = require('../services/restaurantService');
const { authenticateToken } = require('../middleware/auth');

/**
 * POST /api/restaurants/register
 * Register a new restaurant.
 * 
 * Requires authentication (the logged-in user becomes the owner).
 * 
 * Request body example:
 * {
 *   "name": "Downy Thai Kitchen",
 *   "phone": "+1-562-555-0123",
 *   "address": "12345 Downey Ave",
 *   "city": "Downey",
 *   "state": "CA",
 *   "zipCode": "90241",
 *   "latitude": 33.9401,
 *   "longitude": -118.1331,
 *   "cuisineTypes": ["thai", "chinese"]
 * }
 */
router.post('/register', authenticateToken, async (req, res) => {
    try {
        const ownerUserId = req.user.userId;
        const {
            name,
            phone,
            address,
            city,
            state,
            zipCode,
            latitude,
            longitude,
            cuisineTypes,
        } = req.body;

        // Basic validation
        const missingFields = [];
        if (!name) missingFields.push('name');
        if (!phone) missingFields.push('phone');
        if (!address) missingFields.push('address');
        if (!city) missingFields.push('city');
        if (!state) missingFields.push('state');
        if (!zipCode) missingFields.push('zipCode');
        if (latitude === undefined) missingFields.push('latitude');
        if (longitude === undefined) missingFields.push('longitude');

        if (missingFields.length > 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                missingFields,
            });
        }

        // Coordinate sanity check
        if (latitude < -90 || latitude > 90) {
            return res.status(400).json({ error: 'Invalid latitude' });
        }
        if (longitude < -180 || longitude > 180) {
            return res.status(400).json({ error: 'Invalid longitude' });
        }

        const newRestaurant = await restaurantService.registerRestaurant({
            ownerUserId,
            ...req.body,
        });

        return res.status(201).json({
            message: 'Restaurant registered successfully',
            restaurant: newRestaurant,
        });
    } catch (error) {
        console.error('Error registering restaurant:', error);
        return res.status(500).json({
            error: 'Failed to register restaurant',
        });
    }
});

/**
 * GET /api/restaurants/mine
 * Get all restaurants owned by the logged-in user.
 * Used by the restaurant owner dashboard.
 */
router.get('/mine', authenticateToken, async (req, res) => {
    try {
        const ownerUserId = req.user.userId;
        const restaurants = await restaurantService.getRestaurantsByOwner(ownerUserId);

        return res.status(200).json({
            count: restaurants.length,
            restaurants,
        });
    } catch (error) {
        console.error('Error fetching owner restaurants:', error);
        return res.status(500).json({
            error: 'Failed to fetch restaurants',
        });
    }
});

/**
 * GET /api/restaurants/nearby
 * Find active restaurants near a given location.
 * Public endpoint (no auth required) — used during customer discovery.
 * 
 * Query parameters:
 *   ?latitude=33.9401&longitude=-118.1331&maxResults=20
 */
router.get('/nearby', async (req, res) => {
    try {
        const customerLatitude = parseFloat(req.query.latitude);
        const customerLongitude = parseFloat(req.query.longitude);
        const maxResults = parseInt(req.query.maxResults, 10) || 20;

        if (isNaN(customerLatitude) || isNaN(customerLongitude)) {
            return res.status(400).json({
                error: 'latitude and longitude query parameters are required',
            });
        }

        const nearbyRestaurants = await restaurantService.findNearbyRestaurants({
            customerLatitude,
            customerLongitude,
            maxResults,
        });

        return res.status(200).json({
            count: nearbyRestaurants.length,
            restaurants: nearbyRestaurants,
        });
    } catch (error) {
        console.error('Error finding nearby restaurants:', error);
        return res.status(500).json({
            error: 'Failed to find nearby restaurants',
        });
    }
});

/**
 * GET /api/restaurants/:restaurantId
 * Get details of a single restaurant by ID.
 * Public endpoint — used when customer views a restaurant profile.
 */
router.get('/:restaurantId', async (req, res) => {
    try {
        const restaurantId = parseInt(req.params.restaurantId, 10);

        if (isNaN(restaurantId)) {
            return res.status(400).json({ error: 'Invalid restaurant ID' });
        }

        const restaurant = await restaurantService.getRestaurantById(restaurantId);

        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }

        return res.status(200).json({ restaurant });
    } catch (error) {
        console.error('Error fetching restaurant:', error);
        return res.status(500).json({
            error: 'Failed to fetch restaurant',
        });
    }
});

/**
 * PATCH /api/restaurants/:restaurantId
 * Update restaurant information.
 * Requires authentication AND ownership of the restaurant.
 */
router.patch('/:restaurantId', authenticateToken, async (req, res) => {
    try {
        const restaurantId = parseInt(req.params.restaurantId, 10);
        const userId = req.user.userId;

        if (isNaN(restaurantId)) {
            return res.status(400).json({ error: 'Invalid restaurant ID' });
        }

        // Ownership check: confirm this user owns this restaurant
        const existing = await restaurantService.getRestaurantById(restaurantId);
        if (!existing) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        if (existing.owner_user_id !== userId) {
            return res.status(403).json({
                error: 'You do not have permission to update this restaurant',
            });
        }

        const updated = await restaurantService.updateRestaurant(
            restaurantId,
            req.body,
        );

        return res.status(200).json({
            message: 'Restaurant updated successfully',
            restaurant: updated,
        });
    } catch (error) {
        console.error('Error updating restaurant:', error);
        return res.status(500).json({
            error: 'Failed to update restaurant',
        });
    }
});

/**
 * PATCH /api/restaurants/:restaurantId/active-status
 * Toggle restaurant open/closed status.
 * Faster than the full PATCH when only flipping is_active.
 * 
 * Request body: { "isActive": true } or { "isActive": false }
 */
router.patch('/:restaurantId/active-status', authenticateToken, async (req, res) => {
    try {
        const restaurantId = parseInt(req.params.restaurantId, 10);
        const userId = req.user.userId;
        const { isActive } = req.body;

        if (isNaN(restaurantId)) {
            return res.status(400).json({ error: 'Invalid restaurant ID' });
        }

        if (typeof isActive !== 'boolean') {
            return res.status(400).json({
                error: 'isActive must be true or false',
            });
        }

        const existing = await restaurantService.getRestaurantById(restaurantId);
        if (!existing) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        if (existing.owner_user_id !== userId) {
            return res.status(403).json({
                error: 'You do not have permission to change this restaurant',
            });
        }

        const updated = await restaurantService.setRestaurantActiveStatus(
            restaurantId,
            isActive,
        );

        return res.status(200).json({
            message: `Restaurant is now ${isActive ? 'open' : 'closed'}`,
            restaurant: updated,
        });
    } catch (error) {
        console.error('Error toggling active status:', error);
        return res.status(500).json({
            error: 'Failed to update restaurant status',
        });
    }
});

module.exports = router;