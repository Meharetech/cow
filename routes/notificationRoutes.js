const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { authenticate } = require('../middlewares/auth');
const logger = require('../utils/logger');

// Get user notifications
router.get('/', authenticate, async (req, res) => {
    try {
        const { page = 1, limit = 20, unreadOnly = false } = req.query;

        const userModel = req.userRole === 'admin' ? 'Admin' : (req.userRole === 'ngo' || req.userRole === 'shelter' ? 'NGO' : 'Citizen');
        const query = { userId: req.userId, userModel };

        if (unreadOnly === 'true') {
            query.isRead = false;
        }

        const skip = (page - 1) * limit;

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate('caseId', 'condition status city');

        const total = await Notification.countDocuments(query);
        const unreadCount = await Notification.countDocuments({ userId: req.userId, userModel, isRead: false });

        res.json({
            success: true,
            data: {
                notifications,
                unreadCount,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        logger.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications',
            error: error.message
        });
    }
});

// Mark notification as read
router.patch('/:id/read', authenticate, async (req, res) => {
    try {
        const userModel = req.userRole === 'admin' ? 'Admin' : (req.userRole === 'ngo' || req.userRole === 'shelter' ? 'NGO' : 'Citizen');
        const notification = await Notification.findOne({
            _id: req.params.id,
            userId: req.userId,
            userModel
        });

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        notification.markAsRead();
        await notification.save();

        res.json({
            success: true,
            message: 'Notification marked as read',
            data: notification
        });
    } catch (error) {
        logger.error('Mark notification as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notification',
            error: error.message
        });
    }
});

// Mark all notifications as read
router.patch('/read-all', authenticate, async (req, res) => {
    try {
        const userModel = req.userRole === 'admin' ? 'Admin' : (req.userRole === 'ngo' || req.userRole === 'shelter' ? 'NGO' : 'Citizen');
        await Notification.updateMany(
            { userId: req.userId, userModel, isRead: false },
            { isRead: true, readAt: new Date() }
        );

        res.json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        logger.error('Mark all notifications as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notifications',
            error: error.message
        });
    }
});

// Delete notification
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const userModel = req.userRole === 'admin' ? 'Admin' : (req.userRole === 'ngo' || req.userRole === 'shelter' ? 'NGO' : 'Citizen');
        const notification = await Notification.findOneAndDelete({
            _id: req.params.id,
            userId: req.userId,
            userModel
        });

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.json({
            success: true,
            message: 'Notification deleted'
        });
    } catch (error) {
        logger.error('Delete notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification',
            error: error.message
        });
    }
});

module.exports = router;
