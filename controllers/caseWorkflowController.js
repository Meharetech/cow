const Case = require('../models/Case');
const NGO = require('../models/NGO');
const Notification = require('../models/Notification');
// socketService will be imported when needed to avoid circular dependencies
let socketService;
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// In-memory lock to prevent concurrent acceptances by the same NGO bypassing capacity limits
const pendingAcceptances = new Map();

// Enhanced nearby cases with distance calculation and pagination
exports.getEnhancedNearbyCases = async (req, res) => {
    try {
        const { page = 1, limit = 20, radius = 50 } = req.query;

        // Get NGO's location
        const ngo = await NGO.findById(req.userId);

        if (!ngo || !ngo.location || !ngo.location.coordinates) {
            return res.status(400).json({
                success: false,
                message: 'Please set up your location first to see nearby cases'
            });
        }

        const [lng, lat] = ngo.location.coordinates;
        const skip = (page - 1) * limit;
        const radiusInKm = parseFloat(radius);
        const radiusInRadians = radiusInKm / 6378.1; // Earth's radius in km

        // Use $geoWithin instead of $near to avoid sorting issues
        // Exclude cases already declined by this NGO
        const query = {
            status: 'pending',
            assignedNGO: null,
            'declinedBy.ngoId': { $ne: req.userId }, // Exclude if NGO already declined
            location: {
                $geoWithin: {
                    $centerSphere: [[lng, lat], radiusInRadians]
                }
            }
        };

        // Count total first
        const total = await Case.countDocuments(query);

        // Fetch cases
        const cases = await Case.find(query)
            .populate('citizenId', 'name mobile city')
            .lean();


        // Calculate distance for each case and sort by distance
        const casesWithDistance = cases.map(caseItem => {
            const distance = calculateDistance(
                [lng, lat],
                caseItem.location.coordinates
            );
            return {
                ...caseItem,
                distance,
                citizen: caseItem.citizenId
            };
        });

        // Sort by time (latest first)
        casesWithDistance.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Apply pagination after sorting
        const paginatedCases = casesWithDistance.slice(skip, skip + parseInt(limit));

        logger.info(`NGO ${req.userId} fetched ${paginatedCases.length} nearby cases out of ${total} total`);

        // Fetch stats to return with nearby cases
        const activeStatuses = ['accepted', 'reached', 'treating', 'assigned', 'in_progress', 'on_the_way'];
        const [activeCount, resolvedCount, declinedCount] = await Promise.all([
            Case.countDocuments({ assignedNGO: req.userId, status: { $in: activeStatuses } }),
            Case.countDocuments({ assignedNGO: req.userId, status: { $in: ['resolved', 'closed'] } }),
            Case.countDocuments({ 'declinedBy.ngoId': req.userId })
        ]);

        res.json({
            success: true,
            data: {
                cases: paginatedCases,
                stats: {
                    activeCases: activeCount,
                    resolvedCases: resolvedCount,
                    declinedCases: declinedCount
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit),
                    hasMore: skip + paginatedCases.length < total
                },
                radius: `${radius} km`
            }
        });
    } catch (error) {
        logger.error('Get enhanced nearby cases error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch nearby cases',
            error: error.message
        });
    }
};

// Accept case (atomic operation, no transactions needed)
exports.acceptCaseWithTransaction = async (req, res) => {
    // Prevent NGO from double-clicking or concurrently accepting multiple cases to bypass limits
    if (pendingAcceptances.has(req.userId)) {
        return res.status(429).json({
            success: false,
            message: 'You are currently processing another acceptance. Please wait.'
        });
    }

    pendingAcceptances.set(req.userId, true);

    try {
        const { id } = req.params;

        // Get NGO location for distance validation
        const ngo = await NGO.findById(req.userId);

        if (!ngo) {
            return res.status(404).json({
                success: false,
                message: 'NGO not found'
            });
        }

        // Find case to validate distance before taking any action
        const existingCase = await Case.findById(id);
        if (!existingCase) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        if (existingCase.status !== 'pending' || existingCase.assignedNGO) {
            return res.status(400).json({
                success: false,
                message: 'Case is no longer available or already accepted by another NGO'
            });
        }

        // Validate distance (prevent accepting cases too far away) before updating
        if (ngo.location && ngo.location.coordinates && existingCase.location) {
            const distance = calculateDistance(
                ngo.location.coordinates,
                existingCase.location.coordinates
            );

            // Reject if > 100km
            if (distance > 100000) {
                return res.status(403).json({
                    success: false,
                    message: 'Case is too far from your location (max 100km)'
                });
            }
        }

        const timelineEntry = {
            status: 'accepted',
            message: 'Case accepted by NGO',
            updatedBy: req.userId,
            refModel: 'NGO',
            timestamp: new Date()
        };

        // Find and update case atomically (prevents race conditions)
        const caseData = await Case.findOneAndUpdate(
            {
                _id: id,
                status: 'pending',
                assignedNGO: null  // Ensure not already assigned
            },
            {
                $set: {
                    status: 'accepted',
                    assignedNGO: req.userId,
                    acceptedAt: new Date()
                },
                $push: {
                    timeline: timelineEntry
                }
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!caseData) {
            return res.status(400).json({
                success: false,
                message: 'Case is no longer available or already accepted by another NGO'
            });
        }

        // Populate for response
        await caseData.populate('citizenId', 'name mobile city address');

        // Emit real-time update to citizen
        if (!socketService) socketService = require('../services/socketService');
        socketService.emitCaseAccepted(caseData.citizenId._id, ngo, caseData.toObject());

        // Create notification for citizen
        await Notification.create({
            userId: caseData.citizenId._id,
            userModel: 'Citizen',
            type: 'case_accepted',
            title: 'Case Accepted!',
            message: `${ngo.organizationName} has accepted your case and will be reaching out soon.`,
            caseId: caseData._id
        });

        logger.info(`Case ${id} accepted by NGO: ${req.userId}`);

        res.json({
            success: true,
            message: 'Case accepted successfully',
            data: caseData
        });

    } catch (error) {
        logger.error('Accept case error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to accept case',
            error: error.message
        });
    } finally {
        // Release the concurrency lock for this NGO
        pendingAcceptances.delete(req.userId);
    }
};

// Mark as reached location
exports.markAsReached = async (req, res) => {
    try {
        const { id } = req.params;

        const caseData = await Case.findById(id);

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // Verify NGO is assigned to this case
        if (caseData.assignedNGO.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to update this case'
            });
        }

        if (caseData.status !== 'accepted') {
            return res.status(400).json({
                success: false,
                message: 'Case must be in accepted status'
            });
        }

        // Update status
        caseData.status = 'reached';
        caseData.reachedAt = new Date();
        caseData.addTimelineEntry('reached', 'NGO reached the location', req.userId, 'NGO');
        await caseData.save();

        // Populate for response
        await caseData.populate('citizenId assignedNGO');

        // Emit real-time update
        socketService.emitCaseUpdate(caseData.citizenId._id, caseData.toObject());

        // Create notification
        await Notification.create({
            userId: caseData.citizenId._id,
            userModel: 'Citizen',
            type: 'ngo_arrived',
            title: 'Help Has Arrived!',
            message: 'The NGO has reached your location and will begin treatment.',
            caseId: caseData._id
        });

        logger.info(`Case ${id} marked as reached by NGO: ${req.userId}`);

        res.json({
            success: true,
            message: 'Location reached successfully',
            data: caseData
        });
    } catch (error) {
        logger.error('Mark as reached error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update status',
            error: error.message
        });
    }
};

// Add treatment update
exports.addTreatmentUpdate = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, photos, status } = req.body;

        if (!notes) {
            return res.status(400).json({
                success: false,
                message: 'Treatment notes are required'
            });
        }

        const caseData = await Case.findById(id);

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // Verify NGO is assigned
        if (caseData.assignedNGO.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to update this case'
            });
        }

        // Process uploaded files
        let finalPhotoUrls = [];
        if (req.files && req.files['photos']) {
            finalPhotoUrls = req.files['photos'].map(file => file.path.replace(/\\/g, '/'));
        } else if (photos) {
            finalPhotoUrls = Array.isArray(photos) ? photos : [photos];
        }

        let finalVideoUrl = '';
        if (req.files && req.files['video']) {
            finalVideoUrl = req.files['video'][0].path.replace(/\\/g, '/');
        }

        const isFinalCase = req.body.isFinalCase === 'true';

        // Add treatment report
        caseData.treatmentReports.push({
            notes,
            photos: finalPhotoUrls,
            video: finalVideoUrl,
            status: isFinalCase ? 'stable' : (status || 'treating'),
            reportedBy: req.userId,
            reportedAt: new Date()
        });

        // Update case status if needed
        if (isFinalCase) {
            caseData.status = 'closed';
            caseData.finalReport = notes;
            caseData.closedAt = new Date();
            caseData.addTimelineEntry('closed', 'Case closed after treatment', req.userId, 'NGO');
        } else if (caseData.status === 'reached' || caseData.status === 'accepted') {
            caseData.status = 'treating';
            caseData.addTimelineEntry('treating', 'Treatment started', req.userId, 'NGO');
        }

        await caseData.save();

        // Populate for response
        await caseData.populate('citizenId assignedNGO');

        // Emit real-time update
        socketService.emitTreatmentUpdate(caseData.citizenId._id, caseData.toObject());

        // Create notification
        await Notification.create({
            userId: caseData.citizenId._id,
            userModel: 'Citizen',
            type: 'treatment_update',
            title: 'Treatment Update',
            message: 'The NGO has added a treatment update to your case.',
            caseId: caseData._id
        });

        logger.info(`Treatment update added to case ${id} by NGO: ${req.userId}`);

        res.json({
            success: true,
            message: 'Treatment update added successfully',
            data: caseData
        });
    } catch (error) {
        logger.error('Add treatment update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add treatment update',
            error: error.message
        });
    }
};

// Close case with final report
exports.closeCase = async (req, res) => {
    try {
        const { id } = req.params;
        const { finalReport } = req.body;

        if (!finalReport) {
            return res.status(400).json({
                success: false,
                message: 'Final report is required to close the case'
            });
        }

        const caseData = await Case.findById(id);

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // Verify NGO is assigned
        if (caseData.assignedNGO.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to close this case'
            });
        }

        // Update case
        caseData.status = 'closed';
        caseData.finalReport = finalReport;
        caseData.closedAt = new Date();
        caseData.addTimelineEntry('closed', 'Case closed with final report', req.userId, 'NGO');
        await caseData.save();

        // Populate for response
        await caseData.populate('citizenId assignedNGO');

        // Emit real-time update
        socketService.emitCaseUpdate(caseData.citizenId._id, caseData.toObject());

        // Create notification
        await Notification.create({
            userId: caseData.citizenId._id,
            userModel: 'Citizen',
            type: 'case_closed',
            title: 'Case Closed',
            message: 'Your case has been successfully resolved and closed.',
            caseId: caseData._id
        });

        logger.info(`Case ${id} closed by NGO: ${req.userId}`);

        res.json({
            success: true,
            message: 'Case closed successfully',
            data: caseData
        });
    } catch (error) {
        logger.error('Close case error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to close case',
            error: error.message
        });
    }
};

// Helper function to calculate distance between two points (Haversine formula)
function calculateDistance(coords1, coords2) {
    const [lon1, lat1] = coords1;
    const [lon2, lat2] = coords2;

    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

module.exports = {
    getEnhancedNearbyCases: exports.getEnhancedNearbyCases,
    acceptCaseWithTransaction: exports.acceptCaseWithTransaction,
    markAsReached: exports.markAsReached,
    addTreatmentUpdate: exports.addTreatmentUpdate,
    closeCase: exports.closeCase
};
