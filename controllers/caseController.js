const Case = require('../models/Case');
const Admin = require('../models/Admin');
const Citizen = require('../models/Citizen');
const NGO = require('../models/NGO');
const Notification = require('../models/Notification');
// socketService will be imported when needed
let socketService;
const logger = require('../utils/logger');

// Create new case (Citizen)
exports.createCase = async (req, res) => {
    try {
        const { condition, category, latitude, longitude, address, landmark, photoUrls, videoUrl } = req.body;

        // Debug logging
        console.log('📸 Files received:', req.files);
        console.log('📝 Body data:', { condition, latitude, longitude, address, landmark });

        // Get citizen details
        const citizen = await Citizen.findById(req.userId);

        if (!citizen) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Process uploaded files
        let finalPhotoUrls = [];
        if (req.files && req.files['photos']) {
            finalPhotoUrls = req.files['photos'].map(file => file.path.replace(/\\/g, '/'));
        } else if (photoUrls) {
            // Fallback for legacy or if sent as URLs
            finalPhotoUrls = Array.isArray(photoUrls) ? photoUrls : [photoUrls];
        }

        let finalVideoUrl = '';
        if (req.files && req.files['video']) {
            finalVideoUrl = req.files['video'][0].path.replace(/\\/g, '/');
        } else if (videoUrl) {
            finalVideoUrl = videoUrl;
        }

        console.log('✅ Final photo URLs:', finalPhotoUrls);
        console.log('✅ Final video URL:', finalVideoUrl);

        // Generate human-readable tracking ID
        const trackingId = await Case.generateTrackingId(
            citizen.state || req.body.state,
            citizen.city || req.body.city
        );

        // Create case
        const newCase = new Case({
            trackingId,
            condition,
            category: category || 'General',
            caseType: req.body.caseType || 'rescue',
            location: {
                type: 'Point',
                coordinates: [parseFloat(longitude), parseFloat(latitude)]
            },
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            address,
            landmark,
            city: citizen.city || req.body.city || 'Unknown',
            state: citizen.state || req.body.state || 'Unknown',
            photoUrls: finalPhotoUrls,
            videoUrl: finalVideoUrl,
            citizenId: req.userId,
            status: 'pending'
        });

        // Add initial timeline entry
        newCase.addTimelineEntry('pending', 'Case reported', req.userId, 'Citizen');

        // If city/state is unknown, flag for immediate admin intervention
        if (newCase.city === 'Unknown' || newCase.state === 'Unknown') {
            newCase.needsAdminIntervention = true;
            logger.warn(`Case ${newCase._id} created with unknown location metadata. Admin intervention flagged.`);
        }

        await newCase.save();

        // Populate citizen details for socket emission
        await newCase.populate('citizenId', 'name mobile city');

        // Emit real-time event to NGOs in the same city
        if (!socketService) socketService = require('../services/socketService');
        socketService.emitNewCase(newCase.toObject());

        // Smart routing based on case type
        let targetResponders;
        const caseType = newCase.caseType || 'rescue';

        if (caseType === 'shelter') {
            // For shelter cases, notify only shelters
            targetResponders = await NGO.find({
                city: citizen.city,
                role: 'shelter',
                verificationStatus: 'approved',
                isActive: true
            }).select('_id organizationName');
        } else if (caseType === 'medical' || caseType === 'rescue') {
            // For rescue/medical cases, notify NGOs (and shelters if they can help)
            targetResponders = await NGO.find({
                city: citizen.city,
                $or: [
                    { role: 'ngo' },
                    { role: 'shelter', orgType: 'Animal Shelter' } // Shelters that can also rescue
                ],
                verificationStatus: 'approved',
                isActive: true
            }).select('_id organizationName');
        } else {
            // Default: notify all approved responders
            targetResponders = await NGO.find({
                city: citizen.city,
                verificationStatus: 'approved',
                isActive: true
            }).select('_id organizationName');
        }

        logger.info(`Notifying ${targetResponders.length} ${caseType} responders in ${citizen.city}`);

        // Create notification for each targeted responder
        for (const responder of targetResponders) {
            await Notification.create({
                userId: responder._id,
                userModel: 'NGO',
                type: 'case_new',
                title: `New ${caseType.charAt(0).toUpperCase() + caseType.slice(1)} Case`,
                message: `A new ${condition} case (${caseType}) has been reported in ${citizen.city}`,
                caseId: newCase._id
            });

            // Emit notification via socket
            if (!socketService) socketService = require('../services/socketService');
            socketService.emitNotification(responder._id, {
                type: 'case_new',
                title: `New ${caseType} Case`,
                message: `${condition} case reported in ${citizen.city}`,
                caseId: newCase._id,
                caseType: caseType
            });
        }

        logger.info(`New ${caseType} case created: ${newCase._id} by citizen: ${req.userId}`);

        res.status(201).json({
            success: true,
            message: 'Case reported successfully',
            data: newCase
        });
    } catch (error) {
        logger.error('Create case error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create case',
            error: error.message
        });
    }
};

// Get all cases (NGO with filters)
exports.getCases = async (req, res) => {
    try {
        const { status, city, search, caseType, escalatedOnly, declinedOnly, page = 1, limit = 20 } = req.query;

        const query = {};

        // Filter by case type
        if (caseType) {
            query.caseType = caseType;
        }

        // Filter by escalation
        if (escalatedOnly === 'true') {
            query.escalationLevel = { $gt: 0 };
        }

        // Filter by declined status
        if (declinedOnly === 'true') {
            query['declinedBy.0'] = { $exists: true };
        }

        // Search filter (Case ID, Condition, City, etc.)
        if (search) {
            // Check if search is a valid MongoDB ObjectId (for searching by ID)
            const isObjectId = /^[0-9a-fA-F]{24}$/.test(search);

            // Find IDs for matching citizens and NGOs
            const [citizens, ngos] = await Promise.all([
                Citizen.find({ name: { $regex: search, $options: 'i' } }).select('_id'),
                NGO.find({ organizationName: { $regex: search, $options: 'i' } }).select('_id')
            ]);

            const citizenIds = citizens.map(c => c._id);
            const ngoIds = ngos.map(n => n._id);

            query.$or = [
                { condition: { $regex: search, $options: 'i' } },
                { city: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } },
                { landmark: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } },
                { caseType: { $regex: search, $options: 'i' } },
                { citizenId: { $in: citizenIds } },
                { assignedNGO: { $in: ngoIds } }
            ];

            if (isObjectId) {
                query.$or.push({ _id: search });
            }
        }

        // Filter by status
        if (status) {
            query.status = status;
        } else if (req.userRole !== 'admin') {
            // NGOs/Users only see pending/assigned by default
            query.status = { $in: ['pending', 'assigned'] };
        }
        // Admin sees all by default if no status specified

        // Filter by city (NGOs should see cases in their city)
        if (city) {
            query.city = city;
        } else if (req.userRole === 'ngo' || req.userRole === 'shelter') {
            const ngo = await NGO.findById(req.userId);
            if (ngo) {
                query.city = ngo.city;
            }
        }

        const skip = (page - 1) * limit;

        const cases = await Case.find(query)
            .populate('citizenId', 'name mobile city')
            .populate('assignedNGO', 'organizationName mobile email city contactPerson')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Case.countDocuments(query);

        res.json({
            success: true,
            data: {
                cases,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        logger.error('Get cases error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cases',
            error: error.message
        });
    }
};

// Get nearby cases (NGO - geospatial query)
exports.getNearbyCases = async (req, res) => {
    try {
        const { latitude, longitude, radius = 10 } = req.query;

        // Convert radius from km to meters
        const radiusInMeters = radius * 1000;

        const cases = await Case.find({
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [parseFloat(longitude), parseFloat(latitude)]
                    },
                    $maxDistance: radiusInMeters
                }
            },
            status: { $in: ['pending', 'assigned'] },
            'declinedBy.ngoId': { $ne: req.userId } // Exclude cases declined by this NGO
        })
            .populate('citizenId', 'name mobile city')
            .limit(50);


        // Fetch stats to return with active cases
        const activeStatuses = ['accepted', 'reached', 'treating', 'assigned', 'in_progress', 'on_the_way'];
        const [activeCount, resolvedCount, declinedCount] = await Promise.all([
            Case.countDocuments({ assignedNGO: req.userId, status: { $in: activeStatuses } }),
            Case.countDocuments({ assignedNGO: req.userId, status: { $in: ['resolved', 'closed'] } }),
            Case.countDocuments({ 'declinedBy.ngoId': req.userId })
        ]);

        res.json({
            success: true,
            data: {
                cases,
                count: cases.length,
                radius: `${radius} km`,
                stats: {
                    activeCases: activeCount,
                    resolvedCases: resolvedCount,
                    declinedCases: declinedCount
                }
            }
        });
    } catch (error) {
        logger.error('Get nearby cases error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch nearby cases',
            error: error.message
        });
    }
};

// Get case by ID
exports.getCaseById = async (req, res) => {
    try {
        const { id } = req.params;

        const caseData = await Case.findById(id)
            .populate('citizenId', 'name mobile email city state address')
            .populate('assignedNGO', 'organizationName mobile email city state address contactPerson registrationNumber orgType yearEstablished capacity logo verificationStatus createdAt');

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // Increment view count
        caseData.viewCount += 1;
        await caseData.save();

        res.json({
            success: true,
            data: caseData
        });
    } catch (error) {
        logger.error('Get case by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch case',
            error: error.message
        });
    }
};

// Accept case (NGO) - Atomic operation to prevent race conditions
exports.acceptCase = async (req, res) => {
    try {
        const { id } = req.params;

        // Get NGO details for capacity check and notifications
        const ngo = await NGO.findById(req.userId);

        if (!ngo) {
            return res.status(404).json({
                success: false,
                message: 'NGO not found'
            });
        }

        // Check NGO capacity before accepting
        const activeCases = await Case.countDocuments({
            assignedNGO: req.userId,
            status: { $in: ['accepted', 'assigned', 'in_progress', 'on_the_way', 'reached', 'treating'] }
        });

        if (ngo.capacity && activeCases >= ngo.capacity) {
            return res.status(400).json({
                success: false,
                message: `You have reached your maximum capacity of ${ngo.capacity} active cases`
            });
        }

        // Atomic operation - prevents race conditions
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

        // Add timeline entry
        caseData.addTimelineEntry('accepted', `Case accepted by ${ngo.organizationName}`, req.userId, 'NGO');
        await caseData.save();

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

        logger.info(`Case ${id} accepted by NGO: ${req.userId} (${ngo.organizationName})`);

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
    }
};

// Decline case (NGO)
exports.declineCase = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const caseData = await Case.findById(id);

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        if (caseData.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'Can only decline pending cases'
            });
        }

        // Check if already declined by this NGO
        const alreadyDeclined = caseData.declinedBy.some(
            decline => decline.ngoId.toString() === req.userId
        );

        if (alreadyDeclined) {
            return res.status(400).json({
                success: false,
                message: 'You have already declined this case'
            });
        }

        // Get NGO details
        const ngo = await NGO.findById(req.userId);

        // Add to declined list
        caseData.declinedBy.push({
            ngoId: req.userId,
            reason: reason || 'No reason provided',
            declinedAt: new Date()
        });

        // Add timeline entry
        caseData.addTimelineEntry(
            'declined',
            `Declined by ${ngo.organizationName}: ${reason || 'No reason provided'}`,
            req.userId,
            'NGO'
        );

        await caseData.save();

        // Check if all nearby NGOs have declined
        const nearbyNGOs = await NGO.find({
            city: caseData.city,
            verificationStatus: 'approved',
            isActive: true
        });

        const declinePercentage = (caseData.declinedBy.length / nearbyNGOs.length) * 100;

        // If more than 70% declined or all declined, mark for admin intervention
        if (declinePercentage >= 70 || caseData.declinedBy.length >= nearbyNGOs.length) {
            caseData.needsAdminIntervention = true;
            await caseData.save();

            // Notify all admins
            const admins = await Admin.find({ isActive: true });
            for (const admin of admins) {
                await Notification.create({
                    userId: admin._id,
                    userModel: 'Admin',
                    type: 'system',
                    title: 'Case Needs Intervention',
                    message: `Case ${caseData._id} has been declined by ${caseData.declinedBy.length} NGOs in ${caseData.city}. Immediate attention required.`,
                    caseId: caseData._id
                });
            }

            logger.warn(`Case ${id} needs admin intervention - declined by ${caseData.declinedBy.length}/${nearbyNGOs.length} NGOs`);
        }

        logger.info(`Case ${id} declined by NGO: ${req.userId} (${ngo.organizationName})`);

        res.json({
            success: true,
            message: 'Case declined successfully',
            data: {
                caseId: caseData._id,
                declinedCount: caseData.declinedBy.length,
                totalNearbyNGOs: nearbyNGOs.length
            }
        });
    } catch (error) {
        logger.error('Decline case error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to decline case',
            error: error.message
        });
    }
};


// Update case status (NGO)
exports.updateCaseStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, message } = req.body;

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

        // Update status
        caseData.updateStatus(status, message || `Status updated to ${status}`, req.userId, 'NGO');
        await caseData.save();

        // Populate for response
        await caseData.populate('citizenId assignedNGO');

        // Emit real-time update to citizen
        if (!socketService) socketService = require('../services/socketService');
        socketService.emitCaseUpdate(caseData.citizenId._id, caseData.toObject());

        // Create notification for citizen
        const notificationMessages = {
            'in_progress': 'Your case is now in progress',
            'on_the_way': 'Help is on the way!',
            'resolved': 'Your case has been resolved',
            'closed': 'Your case has been closed'
        };

        await Notification.create({
            userId: caseData.citizenId._id,
            userModel: 'Citizen',
            type: 'case_update',
            title: 'Case Status Updated',
            message: notificationMessages[status] || `Case status updated to ${status}`,
            caseId: caseData._id
        });

        logger.info(`Case ${id} status updated to ${status} by NGO: ${req.userId}`);

        res.json({
            success: true,
            message: 'Case status updated successfully',
            data: caseData
        });
    } catch (error) {
        logger.error('Update case status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update case status',
            error: error.message
        });
    }
};

// Reassign case (NGO or Admin)
exports.reassignCase = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, newNGOId } = req.body;

        const caseData = await Case.findById(id)
            .populate('assignedNGO', 'organizationName')
            .populate('citizenId', 'name mobile');

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // Verify authorization - must be assigned NGO or admin
        if (req.userRole !== 'admin' &&
            (!caseData.assignedNGO || caseData.assignedNGO._id.toString() !== req.userId)) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to reassign this case'
            });
        }

        const oldNGOName = caseData.assignedNGO?.organizationName || 'None';
        let newNGOName = 'Unassigned';

        // If reassigning to specific NGO
        if (newNGOId) {
            const newNGO = await NGO.findById(newNGOId);

            if (!newNGO) {
                return res.status(404).json({
                    success: false,
                    message: 'New NGO not found'
                });
            }

            if (!newNGO.isActive || newNGO.verificationStatus !== 'approved') {
                return res.status(400).json({
                    success: false,
                    message: 'Selected NGO is not active or approved'
                });
            }

            // Check new NGO capacity
            const activeCases = await Case.countDocuments({
                assignedNGO: newNGOId,
                status: { $in: ['accepted', 'assigned', 'in_progress', 'on_the_way', 'reached', 'treating'] }
            });

            if (newNGO.capacity && activeCases >= newNGO.capacity) {
                return res.status(400).json({
                    success: false,
                    message: `${newNGO.organizationName} has reached maximum capacity`
                });
            }

            caseData.assignedNGO = newNGOId;
            caseData.status = 'assigned';
            caseData.assignedAt = new Date();
            newNGOName = newNGO.organizationName;

            // Notify new NGO
            await Notification.create({
                userId: newNGOId,
                userModel: 'NGO',
                type: 'case_assigned',
                title: 'Case Reassigned to You',
                message: `Case ${caseData._id} has been reassigned to you. Reason: ${reason || 'Not specified'}`,
                caseId: caseData._id
            });

            socketService.emitNotification(newNGOId, {
                type: 'case_reassigned',
                title: 'New Case Assigned',
                message: `Case reassigned to you from ${oldNGOName}`,
                caseId: caseData._id
            });

        } else {
            // Reassign back to pending
            caseData.assignedNGO = null;
            caseData.status = 'pending';
            caseData.expiryTime = new Date(Date.now() + 30 * 60 * 1000); // Reset expiry
            caseData.escalationLevel = 0; // Reset escalation

            // Notify nearby NGOs
            const nearbyNGOs = await NGO.find({
                city: caseData.city,
                verificationStatus: 'approved',
                isActive: true
            });

            for (const ngo of nearbyNGOs) {
                await Notification.create({
                    userId: ngo._id,
                    userModel: 'NGO',
                    type: 'case_new',
                    title: 'Case Available Again',
                    message: `Case ${caseData._id} is now available. Previous NGO: ${oldNGOName}`,
                    caseId: caseData._id
                });
            }
        }

        // Add timeline entry
        const reassignMessage = newNGOId
            ? `Case reassigned from ${oldNGOName} to ${newNGOName}. Reason: ${reason || 'Not specified'}`
            : `Case unassigned from ${oldNGOName} and returned to pending. Reason: ${reason || 'Not specified'}`;

        caseData.addTimelineEntry(
            'reassigned',
            reassignMessage,
            req.userId,
            req.userRole === 'admin' ? 'Admin' : 'NGO'
        );

        await caseData.save();

        // Notify citizen
        await Notification.create({
            userId: caseData.citizenId._id,
            userModel: 'Citizen',
            type: 'case_update',
            title: 'Case Reassigned',
            message: newNGOId
                ? `Your case has been reassigned to ${newNGOName}`
                : 'Your case is being reassigned to find the best available help',
            caseId: caseData._id
        });

        logger.info(`Case ${id} reassigned from ${oldNGOName} to ${newNGOName} by ${req.userRole}: ${req.userId}`);

        res.json({
            success: true,
            message: 'Case reassigned successfully',
            data: {
                caseId: caseData._id,
                oldNGO: oldNGOName,
                newNGO: newNGOName,
                status: caseData.status
            }
        });

    } catch (error) {
        logger.error('Reassign case error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reassign case',
            error: error.message
        });
    }
};


// Get my reports (Citizen)
exports.getMyReports = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        const query = { citizenId: req.userId };

        if (status) {
            query.status = status;
        }

        const skip = (page - 1) * limit;

        const cases = await Case.find(query)
            .populate('assignedNGO', 'organizationName mobile contactPerson')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Case.countDocuments(query);

        res.json({
            success: true,
            data: {
                cases,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        logger.error('Get my reports error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reports',
            error: error.message
        });
    }
};

// Get my accepted cases (NGO)
exports.getMyAcceptedCases = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        const query = { assignedNGO: req.userId };

        if (status) {
            query.status = status;
        }

        const skip = (page - 1) * limit;

        const cases = await Case.find(query)
            .populate('citizenId', 'name mobile city address')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Case.countDocuments(query);

        // Fetch stats to return with accepted cases
        const activeStatuses = ['accepted', 'reached', 'treating', 'assigned', 'in_progress', 'on_the_way'];
        const [activeCount, resolvedCount, declinedCount] = await Promise.all([
            Case.countDocuments({ assignedNGO: req.userId, status: { $in: activeStatuses } }),
            Case.countDocuments({ assignedNGO: req.userId, status: { $in: ['resolved', 'closed'] } }),
            Case.countDocuments({ 'declinedBy.ngoId': req.userId })
        ]);

        res.json({
            success: true,
            data: {
                cases,
                stats: {
                    activeCases: activeCount,
                    resolvedCases: resolvedCount,
                    declinedCases: declinedCount
                },
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        logger.error('Get my accepted cases error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch accepted cases',
            error: error.message
        });
    }
};

// Delete case (Citizen)
exports.deleteCase = async (req, res) => {
    try {
        const { id } = req.params;

        const caseData = await Case.findById(id);

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: 'Case not found'
            });
        }

        // Verify citizen is the one who reported this case
        if (caseData.citizenId.toString() !== req.userId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to delete this case'
            });
        }

        // Only allowed to delete if status is pending
        if (caseData.status !== 'pending' && req.userRole !== 'admin') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete a case that is already assigned or in progress'
            });
        }

        await Case.findByIdAndDelete(id);

        logger.info(`Case ${id} deleted by user: ${req.userId}`);

        res.json({
            success: true,
            message: 'Case deleted successfully'
        });
    } catch (error) {
        logger.error('Delete case error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete case',
            error: error.message
        });
    }
};

// Get NGO dashboard stats
exports.getNGOStats = async (req, res) => {
    try {
        const activeCasesQuery = {
            assignedNGO: req.userId,
            status: { $in: ['accepted', 'reached', 'treating', 'assigned', 'in_progress', 'on_the_way'] }
        };

        const resolvedCasesQuery = {
            assignedNGO: req.userId,
            status: { $in: ['resolved', 'closed'] }
        };

        const declinedCasesQuery = {
            'declinedBy.ngoId': req.userId
        };

        const [activeCount, resolvedCount, declinedCount] = await Promise.all([
            Case.countDocuments(activeCasesQuery),
            Case.countDocuments(resolvedCasesQuery),
            Case.countDocuments(declinedCasesQuery)
        ]);

        res.json({
            success: true,
            data: {
                activeCases: activeCount,
                resolvedCases: resolvedCount,
                declinedCases: declinedCount
            }
        });
    } catch (error) {
        logger.error('Get NGO stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard stats',
            error: error.message
        });
    }
};

// Get cases declined by this NGO
exports.getDeclinedCases = async (req, res) => {
    try {
        const cases = await Case.find({
            'declinedBy.ngoId': req.userId
        }).sort({ updatedAt: -1 });

        // Map cases to include the specific decline reason for this NGO
        const result = cases.map(c => {
            const declineInfo = c.declinedBy.find(d => d.ngoId.toString() === req.userId);
            const caseObj = c.toObject();
            return {
                ...caseObj,
                declinedReason: declineInfo ? declineInfo.reason : 'No reason provided',
                declinedAt: declineInfo ? declineInfo.declinedAt : c.updatedAt
            };
        });

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Get declined cases error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch declined cases',
            error: error.message
        });
    }
};
