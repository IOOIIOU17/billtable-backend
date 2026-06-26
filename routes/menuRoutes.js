const express = require('express');
const uploadToCloudinary = require('../middleware/cloudinaryUpload');
const router = express.Router();
const menuService = require('../services/menuService');
const restaurantService = require('../services/restaurantService');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../middleware/upload');

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

// POST /api/menus
router.post('/', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { restaurantId, name, price, description, category, cuisineType, available } = req.body;

    if (!restaurantId) return res.status(400).json({ error: 'Missing required fields', missingFields: ['restaurantId'] });
    if (!name) return res.status(400).json({ error: 'Missing required fields', missingFields: ['name'] });
    if (price === undefined) return res.status(400).json({ error: 'Missing required fields', missingFields: ['price'] });
    if (price < 0) return res.status(400).json({ error: 'Price cannot be negative' });

    if (req.user.role !== 'admin') {
      if (req.user.role !== 'admin') await verifyRestaurantOwnership(restaurantId, userId);
    }

    const imageUrl = req.file ? await uploadToCloudinary(req.file.buffer) : null;

    const newItem = await menuService.addMenuItem({
      ...req.body,
      imageUrl,
      image_url: imageUrl,
      description: description || null,
      category: category || 'main',
      cuisineType: cuisineType || null,
    });

    return res.status(201).json({ message: 'Menu item added successfully', menuItem: newItem });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error adding menu item:', error);
    return res.status(500).json({ error: 'Failed to add menu item' });
  }
});

// POST /api/menus/bulk
router.post('/bulk', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { restaurantId, items } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items must be a non-empty array' });
    if (req.user.role !== 'admin') await verifyRestaurantOwnership(restaurantId, userId);
    const result = await menuService.bulkAddMenuItems(restaurantId, items);
    return res.status(201).json({ message: `${result.insertedCount} menu items added successfully`, ...result });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error bulk adding menu items:', error);
    return res.status(500).json({ error: 'Failed to add menu items' });
  }
});

// GET /api/menus/restaurant/:restaurantId
router.get('/restaurant/:restaurantId', authenticateToken, async (req, res) => {
  try {
    const restaurantId = parseInt(req.params.restaurantId, 10);
    const availableOnly = req.query.availableOnly === 'true';
    if (isNaN(restaurantId)) return res.status(400).json({ error: 'Invalid restaurant ID' });
    const menuItems = await menuService.getMenuByRestaurant(restaurantId, { availableOnly });
    return res.status(200).json({ count: menuItems.length, menuItems });
  } catch (error) {
    console.error('Error fetching menu:', error);
    return res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

// GET /api/menus/:menuItemId
router.get('/:menuItemId', async (req, res) => {
  try {
    const menuItemId = parseInt(req.params.menuItemId, 10);
    if (isNaN(menuItemId)) return res.status(400).json({ error: 'Invalid menu item ID' });
    const item = await menuService.getMenuItemById(menuItemId);
    if (!item) return res.status(404).json({ error: 'Menu item not found' });
    return res.status(200).json({ menuItem: item });
  } catch (error) {
    console.error('Error fetching menu item:', error);
    return res.status(500).json({ error: 'Failed to fetch menu item' });
  }
});

// PUT /api/menus/:menuItemId
router.put('/:menuItemId', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const menuItemId = parseInt(req.params.menuItemId, 10);
    const userId = req.user.userId;
    if (isNaN(menuItemId)) return res.status(400).json({ error: 'Invalid menu item ID' });
    const existing = await menuService.getMenuItemById(menuItemId);
    if (!existing) return res.status(404).json({ error: 'Menu item not found' });
    if (req.user.role !== 'admin') await verifyRestaurantOwnership(existing.restaurant_id, userId);

    const imageUrl = req.file ? await uploadToCloudinary(req.file.buffer) : existing.image_url;

    const updated = await menuService.updateMenuItem(menuItemId, {
      ...req.body,
      image_url: imageUrl,
    });
    return res.status(200).json({ message: 'Menu item updated successfully', menuItem: updated });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error updating menu item:', error);
    return res.status(500).json({ error: 'Failed to update menu item' });
  }
});

// PATCH /api/menus/:menuItemId/availability
router.patch('/:menuItemId/availability', authenticateToken, async (req, res) => {
  try {
    const menuItemId = parseInt(req.params.menuItemId, 10);
    const userId = req.user.userId;
    const { isAvailable } = req.body;
    if (isNaN(menuItemId)) return res.status(400).json({ error: 'Invalid menu item ID' });
    if (typeof isAvailable !== 'boolean') return res.status(400).json({ error: 'isAvailable must be true or false' });
    const existing = await menuService.getMenuItemById(menuItemId);
    if (!existing) return res.status(404).json({ error: 'Menu item not found' });
    if (req.user.role !== 'admin') await verifyRestaurantOwnership(existing.restaurant_id, userId);
    const updated = await menuService.setMenuItemAvailability(menuItemId, isAvailable);
    return res.status(200).json({ message: `Menu item is now ${isAvailable ? 'available' : 'sold out'}`, menuItem: updated });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error toggling availability:', error);
    return res.status(500).json({ error: 'Failed to update availability' });
  }
});

// DELETE /api/menus/:menuItemId
router.delete('/:menuItemId', authenticateToken, async (req, res) => {
  try {
    const menuItemId = parseInt(req.params.menuItemId, 10);
    const userId = req.user.userId;
    if (isNaN(menuItemId)) return res.status(400).json({ error: 'Invalid menu item ID' });
    const existing = await menuService.getMenuItemById(menuItemId);
    if (!existing) return res.status(404).json({ error: 'Menu item not found' });
    if (req.user.role !== 'admin') await verifyRestaurantOwnership(existing.restaurant_id, userId);
    const deleted = await menuService.deleteMenuItem(menuItemId);
    if (!deleted) return res.status(500).json({ error: 'Failed to delete menu item' });
    return res.status(200).json({ message: 'Menu item deleted successfully' });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error deleting menu item:', error);
    return res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

// POST /api/menus/search
router.post('/search', async (req, res) => {
  try {
    const results = await menuService.searchMenuItems(req.body);
    return res.status(200).json({ count: results.length, menuItems: results });
  } catch (error) {
    console.error('Error searching menu:', error);
    return res.status(500).json({ error: 'Failed to search menu' });
  }
});

module.exports = router;
