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
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../db');

router.post('/register', authenticateToken, async (req, res) => {
    try {
        const ownerUserId = req.user.userId;
        const {
            name, phone, address, city, state, zipCode,
            latitude, longitude, cuisineTypes,
        } = req.body;

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
            return res.status(400).json({ error: 'Missing required fields', missingFields });
        }

        if (latitude < -90 || latitude > 90) {
            return res.status(400).json({ error: 'Invalid latitude' });
        }
        if (longitude < -180 || longitude > 180) {
            return res.status(400).json({ error: 'Invalid longitude' });
        }

        const newRestaurant = await restaurantService.registerRestaurant({
            ownerUserId, ...req.body,
        });

        return res.status(201).json({
            message: 'Restaurant registered successfully',
            restaurant: newRestaurant,
        });
    } catch (error) {
        console.error('Error registering restaurant:', error);
        return res.status(500).json({ error: 'Failed to register restaurant' });
    }
});

router.get('/mine', authenticateToken, async (req, res) => {
    try {
        const ownerUserId = req.user.userId;
        const restaurants = await restaurantService.getRestaurantsByOwner(ownerUserId);
        return res.status(200).json({ count: restaurants.length, restaurants });
    } catch (error) {
        console.error('Error fetching owner restaurants:', error);
        return res.status(500).json({ error: 'Failed to fetch restaurants' });
    }
});

router.get('/nearby', async (req, res) => {
    try {
        const customerLatitude = parseFloat(req.query.latitude);
        const customerLongitude = parseFloat(req.query.longitude);
        const maxResults = parseInt(req.query.maxResults, 10) || 20;

        if (isNaN(customerLatitude) || isNaN(customerLongitude)) {
            return res.status(400).json({ error: 'latitude and longitude query parameters are required' });
        }

        const nearbyRestaurants = await restaurantService.findNearbyRestaurants({
            customerLatitude, customerLongitude, maxResults,
        });

        return res.status(200).json({ count: nearbyRestaurants.length, restaurants: nearbyRestaurants });
    } catch (error) {
        console.error('Error finding nearby restaurants:', error);
        return res.status(500).json({ error: 'Failed to find nearby restaurants' });
    }
});


router.get('/all', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*, u.email as owner_email,
        (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id) as total_orders
       FROM restaurants r
       LEFT JOIN users u ON r.owner_user_id = u.id
       WHERE r.is_deleted = false
          ORDER BY r.created_at DESC, r.id ASC`
    );
    return res.status(200).json({ restaurants: result.rows });
  } catch (error) {
    console.error('Error fetching all restaurants:', error);
    return res.status(500).json({ error: 'Failed to fetch restaurants' });
  }
});

router.get('/:restaurantId', async (req, res) => {
    try {
        const restaurantId = parseInt(req.params.restaurantId, 10);
        if (isNaN(restaurantId)) {
            return res.status(400).json({ error: 'Invalid restaurant ID' });
        }
        const restaurant = await restaurantService.getPublicRestaurantById(restaurantId);
        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        return res.status(200).json({ restaurant });
    } catch (error) {
        console.error('Error fetching restaurant:', error);
        return res.status(500).json({ error: 'Failed to fetch restaurant' });
    }
});

router.patch('/:restaurantId', authenticateToken, async (req, res) => {
    try {
        const restaurantId = parseInt(req.params.restaurantId, 10);
        const userId = req.user.userId;

        if (isNaN(restaurantId)) {
            return res.status(400).json({ error: 'Invalid restaurant ID' });
        }

        const existing = await restaurantService.getRestaurantById(restaurantId);
        if (!existing) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        if (req.user.role !== 'admin' && existing.owner_user_id !== userId) {
            return res.status(403).json({ error: 'You do not have permission to update this restaurant' });
        }

        const updated = await restaurantService.updateRestaurant(restaurantId, req.body);
        return res.status(200).json({ message: 'Restaurant updated successfully', restaurant: updated });
    } catch (error) {
        console.error('Error updating restaurant:', error);
        return res.status(500).json({ error: 'Failed to update restaurant' });
    }
});

router.patch('/:restaurantId/active-status', authenticateToken, async (req, res) => {
    try {
        const restaurantId = parseInt(req.params.restaurantId, 10);
        const userId = req.user.userId;
        const { isActive } = req.body;

        if (isNaN(restaurantId)) {
            return res.status(400).json({ error: 'Invalid restaurant ID' });
        }
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'isActive must be true or false' });
        }

        const existing = await restaurantService.getRestaurantById(restaurantId);
        if (!existing) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }
        if (existing.owner_user_id !== userId) {
            return res.status(403).json({ error: 'You do not have permission to change this restaurant' });
        }

        const updated = await restaurantService.setRestaurantActiveStatus(restaurantId, isActive);
        return res.status(200).json({
            message: `Restaurant is now ${isActive ? 'open' : 'closed'}`,
            restaurant: updated,
        });
    } catch (error) {
        console.error('Error toggling active status:', error);
        return res.status(500).json({ error: 'Failed to update restaurant status' });
    }
});

router.post('/onboarding-check', authenticateToken, async (req, res) => {
    try {
        const { restaurantId } = req.body;
        const restaurant = await restaurantService.getRestaurantById(restaurantId);

        if (!restaurant) {
            return res.status(404).json({ error: 'Restaurant not found' });
        }

        const alerts = [];
        if (!restaurant.name) alerts.push('ชื่อร้านยังไม่ได้กรอก');
        if (!restaurant.phone) alerts.push('เบอร์โทรยังไม่ได้กรอก');
        if (!restaurant.address) alerts.push('ที่อยู่ยังไม่ได้กรอก');
        if (!restaurant.latitude || !restaurant.longitude) alerts.push('Location ยังไม่ได้ตั้งค่า');
        if (!restaurant.cuisine_types || restaurant.cuisine_types.length === 0) alerts.push('ประเภทอาหารยังไม่ได้เลือก');

        if (alerts.length > 0) {
            await db.query(
                `INSERT INTO ai_alerts (restaurant_id, message, created_at) VALUES ($1, $2, NOW())`,
                [restaurantId, `Onboarding incomplete: ${alerts.join(', ')}`]
            );
            return res.status(200).json({ status: 'incomplete', alerts });
        }

        return res.status(200).json({ status: 'complete', alerts: [] });

    } catch (error) {
        console.error('Onboarding check error:', error);
        return res.status(500).json({ error: 'Failed to check onboarding' });
    }
});

module.exports = router;