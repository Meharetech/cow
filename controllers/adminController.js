const Citizen = require('../models/Citizen');
const NGO = require('../models/NGO');
const Case = require('../models/Case');
const logger = require('../utils/logger');

// Get all users with filters
exports.getAllUsers = async (req, res) => {
    try {
        const { role, city, status, search } = req.query;

        const query = {};

        if (city) query.city = new RegExp(city, 'i');
        if (status) {
            if (status === 'active') query.isActive = true;
            if (status === 'inactive') query.isActive = false;
        }

        const { verificationStatus } = req.query;
        if (verificationStatus) {
            query.verificationStatus = verificationStatus;
        }

        if (search) {
            query.$or = [
                { name: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') },
                { mobile: new RegExp(search, 'i') },
                { organizationName: new RegExp(search, 'i') }
            ];
        }

        let users = [];
        if (role === 'citizen') {
            users = await Citizen.find(query).sort({ createdAt: -1 });
        } else if (role === 'ngo' || role === 'shelter') {
            users = await NGO.find(query).sort({ createdAt: -1 });
        } else {
            // Fetch both if role not specified
            const [citizens, ngos] = await Promise.all([
                Citizen.find(query).sort({ createdAt: -1 }),
                NGO.find(query).sort({ createdAt: -1 })
            ]);
            users = [...citizens, ...ngos].sort((a, b) => b.createdAt - a.createdAt);
        }

        // Fetch report counts for each user
        const usersWithCounts = await Promise.all(users.map(async (user) => {
            const reportsCount = await Case.countDocuments({ citizenId: user._id });
            const userObj = user.toJSON();
            userObj.reportsCount = reportsCount;
            return userObj;
        }));

        res.json({
            success: true,
            data: usersWithCounts
        });
    } catch (error) {
        logger.error('Admin getAllUsers error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users',
            error: error.message
        });
    }
};

// Update user details
exports.updateUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const updates = req.body;

        // Find user across models
        const [citizen, ngo] = await Promise.all([
            Citizen.findById(userId),
            NGO.findById(userId)
        ]);

        const user = citizen || ngo;

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Apply updates
        Object.assign(user, updates);
        await user.save();

        res.json({
            success: true,
            message: 'User updated successfully',
            data: user.toJSON()
        });
    } catch (error) {
        logger.error('Admin updateUser error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user',
            error: error.message
        });
    }
};

// Delete user
exports.deleteUser = async (req, res) => {
    try {
        const { userId } = req.params;

        // Try deleting from both collections
        const [citizen, ngo] = await Promise.all([
            Citizen.findByIdAndDelete(userId),
            NGO.findByIdAndDelete(userId)
        ]);

        const user = citizen || ngo;

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        logger.error('Admin deleteUser error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user',
            error: error.message
        });
    }
};
// Manual override case details (Dispatcher/Admin)
exports.overrideCase = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const caseData = await Case.findById(id);

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // If status is updated, add a special override timeline entry
        if (updates.status && updates.status !== caseData.status) {
            caseData.addTimelineEntry(
                updates.status,
                updates.reason || 'Case manually overridden by Dispatcher',
                req.userId,
                'Admin'
            );
        }

        // If assigning to a different NGO
        if (updates.assignedNGO) {
            caseData.assignedNGO = updates.assignedNGO;
            // Ensure status is at least 'accepted' or 'assigned' if an NGO is assigned
            if (caseData.status === 'pending') {
                caseData.status = 'accepted';
            }
        }

        // Handle expiry time extension
        if (updates.extendMinutes) {
            const currentExpiry = caseData.expiryTime || new Date();
            caseData.expiryTime = new Date(currentExpiry.getTime() + (updates.extendMinutes * 60 * 1000));
            // If it was expired and marked for intervention, clear it since we gave more time
            caseData.needsAdminIntervention = false;
        }

        // Apply all other updates
        Object.assign(caseData, updates);
        await caseData.save();

        // Populate for response
        await caseData.populate('citizenId assignedNGO');

        logger.info(`Case ${id} manually overridden by admin: ${req.userId}`);

        res.json({
            success: true,
            message: 'Case updated successfully (Manual Override)',
            data: caseData
        });
    } catch (error) {
        logger.error('Admin overrideCase error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update case',
            error: error.message
        });
    }
};
