/**
 * ============================================================
 * BillTable Order Routes
 * ============================================================
 * Purpose: HTTP endpoints for order operations
 * Handles: Create order, get orders, update status
 * 
 * Mounted at: /api/orders
 * Rewritten: Phase 4 (aligned middleware to authenticateToken)
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

/**
 * POST /api/orders
 * Create a new order.
 * Requires login.
 * 
 * Request body example:
 * {
 *   "restaurantId": 1,
 *   "items": [
 *     { "name": "Pad Thai", "quantity": 2, "unitPrice": 12.99 },
 *     { "name": "Green Curry", "quantity": 1, "unitPrice": 14.50 }
 *   ]
 * }
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { restaurantId, items } = req.body;

        if (!restaurantId || !items) {
            return res.status(400).json({
                status: 'ERROR',
                message: 'Restaurant ID and items are required',
            });
        }

        const order = await orderService.createOrder(
            req.user.userId,
            restaurantId,
            items
        );

        return res.status(201).json({
            status: 'OK',
            message: 'Order created successfully',
            data: order,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Create order endpoint error');
        return res.status(400).json({
            status: 'ERROR',
            message: error.message,
        });
    }
});

/**
 * GET /api/orders
 * Get all orders for the logged-in user.
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const orders = await orderService.getUserOrders(req.user.userId);

        return res.status(200).json({
            status: 'OK',
            data: orders,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Get orders endpoint error');
        return res.status(400).json({
            status: 'ERROR',
            message: error.message,
        });
    }
});

/**
 * GET /api/orders/:orderId
 * Get details of a specific order.
 * Only the order's owner can view it.
 */
router.get('/:orderId', authenticateToken, async (req, res) => {
    try {
        const order = await orderService.getOrderById(
            req.params.orderId,
            req.user.userId
        );

        if (!order) {
            return res.status(404).json({
                status: 'ERROR',
                message: 'Order not found',
            });
        }

        return res.status(200).json({
            status: 'OK',
            data: order,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Get order endpoint error');
        return res.status(400).json({
            status: 'ERROR',
            message: error.message,
        });
    }
});

/**
 * PATCH /api/orders/:orderId/status
 * Update the status of an order.
 * Used by restaurants to update order workflow.
 * 
 * Request body example: { "status": "preparing" }
 */
router.patch('/:orderId/status', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({
                status: 'ERROR',
                message: 'Status is required',
            });
        }

        const order = await orderService.updateOrderStatus(
            req.params.orderId,
            status
        );

        return res.status(200).json({
            status: 'OK',
            message: 'Order status updated',
            data: order,
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Update order status endpoint error');
        return res.status(400).json({
            status: 'ERROR',
            message: error.message,
        });
    }
});

module.exports = router;