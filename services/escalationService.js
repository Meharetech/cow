const cron = require('node-cron');
const Case = require('../models/Case');
const NGO = require('../models/NGO');
const Admin = require('../models/Admin');
const Notification = require('../models/Notification');
const socketService = require('./socketService');
const logger = require('../utils/logger');

/**
 * Case Escalation Service
 * Handles automatic escalation of pending cases that haven't been accepted
 */

// Check for expired cases every 5 minutes
const startEscalationMonitoring = () => {
    cron.schedule('*/5 * * * *', async () => {
        try {
            logger.info('Running case escalation check...');

            const now = new Date();

            // Find pending cases that have expired
            const expiredCases = await Case.find({
                status: 'pending',
                expiryTime: { $lt: now },
                needsAdminIntervention: false
            }).populate('citizenId', 'name city');

            logger.info(`Found ${expiredCases.length} expired pending cases`);

            for (const caseData of expiredCases) {
                await escalateCase(caseData);
            }

            // check for stale active cases (accepted but not completed in 24h)
            await checkStaleActiveCases();

            // check for cases accepted but not reached in 2 hours (Reminders)
            await checkAcceptedButNotReached();

            // check for pending cases not accepted for 2+ hours
            await checkFailedToAcceptCases();

        } catch (error) {
            logger.error('Escalation monitoring error:', error);
        }
    });

    logger.info('✅ Case escalation monitoring started (runs every 5 minutes)');
};

/**
 * Escalate a single case
 */
const escalateCase = async (caseData) => {
    try {
        const currentLevel = caseData.escalationLevel || 0;
        const newLevel = Math.min(currentLevel + 1, 3);

        logger.info(`Escalating case ${caseData._id} from level ${currentLevel} to ${newLevel}`);

        // Update escalation level
        caseData.escalationLevel = newLevel;
        caseData.lastEscalatedAt = new Date();

        // Get a system admin for timeline entry
        const systemAdmin = await Admin.findOne({ isActive: true });

        // Use the admin ID if found, otherwise use the citizen ID as a fallback actor 
        // to satisfy the 'required' updatedBy field in the schema.
        const adminId = systemAdmin ? systemAdmin._id : caseData.citizenId;
        const refModel = systemAdmin ? 'Admin' : 'Citizen';

        if (!systemAdmin) {
            logger.warn(`No active admin found for escalation of case ${caseData._id}. Falling back to citizen ID for timeline requirement.`);
        }

        // Escalation actions based on level
        switch (newLevel) {
            case 1:
                // Level 1: Extend expiry by 20 minutes, increase priority, notify more NGOs
                caseData.expiryTime = new Date(Date.now() + 20 * 60 * 1000);
                if (caseData.priority === 'low') caseData.priority = 'medium';
                else if (caseData.priority === 'medium') caseData.priority = 'high';

                // Notify NGOs in nearby cities (expand radius)
                await notifyExpandedRadius(caseData, 50); // 50km radius

                caseData.addTimelineEntry(
                    'escalated',
                    'Case escalated to Level 1 - Expanded notification radius',
                    adminId,
                    refModel
                );
                break;

            case 2:
                // Level 2: Extend expiry by 30 minutes, set to high priority, notify all NGOs in state
                caseData.expiryTime = new Date(Date.now() + 30 * 60 * 1000);
                caseData.priority = 'high';

                await notifyStateWideNGOs(caseData);

                // Notify admins
                await notifyAdmins(caseData, 'Case Escalated to Level 2',
                    `Case ${caseData._id} in ${caseData.city} has not been accepted for 30+ minutes`);

                caseData.addTimelineEntry(
                    'escalated',
                    'Case escalated to Level 2 - State-wide notification sent, admins alerted',
                    adminId,
                    refModel
                );
                break;

            case 3:
                // Level 3: Critical - Mark for admin intervention
                caseData.priority = 'critical';
                caseData.needsAdminIntervention = true;

                await notifyAdmins(caseData, '🚨 CRITICAL: Case Needs Immediate Intervention',
                    `Case ${caseData._id} in ${caseData.city} has been pending for over 1 hour. No NGO has accepted. IMMEDIATE ACTION REQUIRED.`);

                caseData.addTimelineEntry(
                    'escalated',
                    'Case escalated to Level 3 - CRITICAL - Admin intervention required',
                    adminId,
                    refModel
                );
                break;
        }

        await caseData.save();

        logger.info(`✅ Case ${caseData._id} escalated to level ${newLevel}`);

    } catch (error) {
        logger.error(`Error escalating case ${caseData._id}:`, error);
    }
};

/**
 * Notify NGOs in expanded radius
 */
const notifyExpandedRadius = async (caseData, radiusKm) => {
    try {
        const radiusInMeters = radiusKm * 1000;

        const nearbyNGOs = await NGO.find({
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: caseData.location.coordinates
                    },
                    $maxDistance: radiusInMeters
                }
            },
            verificationStatus: 'approved',
            isActive: true,
            _id: { $nin: caseData.declinedBy.map(d => d.ngoId) } // Exclude those who already declined
        });

        logger.info(`Notifying ${nearbyNGOs.length} NGOs within ${radiusKm}km radius`);

        for (const ngo of nearbyNGOs) {
            await Notification.create({
                userId: ngo._id,
                userModel: 'NGO',
                type: 'case_new',
                title: '⚠️ Urgent Case - Expanded Radius',
                message: `ESCALATED: ${caseData.condition} case in ${caseData.city} needs immediate attention (${radiusKm}km radius)`,
                caseId: caseData._id
            });

            // Emit socket notification
            socketService.emitNotification(ngo._id, {
                type: 'case_escalated',
                title: '⚠️ Urgent Case',
                message: `Escalated case needs help in ${caseData.city}`,
                caseId: caseData._id,
                priority: caseData.priority
            });
        }

    } catch (error) {
        logger.error('Error notifying expanded radius:', error);
    }
};

/**
 * Notify all NGOs in the state
 */
const notifyStateWideNGOs = async (caseData) => {
    try {
        const stateNGOs = await NGO.find({
            state: caseData.state,
            verificationStatus: 'approved',
            isActive: true,
            _id: { $nin: caseData.declinedBy.map(d => d.ngoId) }
        });

        logger.info(`Notifying ${stateNGOs.length} NGOs state-wide in ${caseData.state}`);

        for (const ngo of stateNGOs) {
            await Notification.create({
                userId: ngo._id,
                userModel: 'NGO',
                type: 'case_new',
                title: '🚨 URGENT: State-Wide Alert',
                message: `CRITICAL: ${caseData.condition} case in ${caseData.city}, ${caseData.state} needs immediate help`,
                caseId: caseData._id
            });

            socketService.emitNotification(ngo._id, {
                type: 'case_critical',
                title: '🚨 Critical Case',
                message: `State-wide alert: Case in ${caseData.city} needs urgent help`,
                caseId: caseData._id,
                priority: 'critical'
            });
        }

    } catch (error) {
        logger.error('Error notifying state-wide NGOs:', error);
    }
};

/**
 * Notify all admins
 */
const notifyAdmins = async (caseData, title, message) => {
    try {
        const admins = await Admin.find({ isActive: true });

        for (const admin of admins) {
            await Notification.create({
                userId: admin._id,
                userModel: 'Admin',
                type: 'system',
                title,
                message,
                caseId: caseData._id
            });

            socketService.emitNotification(admin._id, {
                type: 'admin_alert',
                title,
                message,
                caseId: caseData._id,
                priority: caseData.priority
            });
        }

        logger.info(`Admins notified about case ${caseData._id}`);

    } catch (error) {
        logger.error('Error notifying admins:', error);
    }
};

/**
 * Check for cases that were accepted/assigned but not completed within 24 hours
 * These are marked as closed (incomplete) per user requirement
 */
const checkStaleActiveCases = async () => {
    try {
        const now = new Date();
        const staleThreshold = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago

        // Get an admin ID for system updates
        const systemAdmin = await Admin.findOne({ isActive: true });
        if (!systemAdmin) {
            logger.error('No active admin found for system updates');
            return;
        }

        // Active statuses that should have been completed
        const activeStatuses = ['accepted', 'reached', 'treating', 'assigned', 'in_progress', 'on_the_way'];

        const staleCases = await Case.find({
            status: { $in: activeStatuses },
            $or: [
                { acceptedAt: { $lt: staleThreshold } },
                { assignedAt: { $lt: staleThreshold } }
            ]
        }).populate('citizenId assignedNGO');

        if (staleCases.length > 0) {
            logger.info(`Found ${staleCases.length} stale active cases to be processed`);
        }

        for (const caseData of staleCases) {
            const assignedNGO = caseData.assignedNGO;
            logger.warn(`Stale case processing: ${caseData._id} assigned to ${assignedNGO?.organizationName || 'Unknown NGO'}`);

            // Add to declined list so it shows in NGO's decline menu
            if (assignedNGO) {
                caseData.declinedBy.push({
                    ngoId: assignedNGO._id,
                    reason: 'Auto-declined: NGO failed to complete work within 24 hours.',
                    declinedAt: new Date()
                });
            }

            // Record the failure in timeline
            caseData.addTimelineEntry(
                'declined',
                `Auto-declined: NGO ${assignedNGO?.organizationName || 'assigned'} failed to complete the case within 24 hours.`,
                assignedNGO ? assignedNGO._id : systemAdmin._id,
                assignedNGO ? 'NGO' : 'Admin'
            );

            // Close the case as incomplete
            caseData.updateStatus(
                'rejected',
                'Automated rejection: Work incomplete after 24 hours of acceptance/assignment.',
                systemAdmin._id,
                'Admin'
            );

            // Clear assigned NGO as they are now officially 'declined/stale' for this case
            caseData.assignedNGO = null;

            await caseData.save();

            // Notify Citizen
            if (caseData.citizenId) {
                await Notification.create({
                    userId: caseData.citizenId._id,
                    userModel: 'Citizen',
                    type: 'case_update',
                    title: 'Case Rejected (Incomplete)',
                    message: `Your reported case was marked as rejected because no final progress was reported by the NGO within 24 hours. We apologize for the delay.`,
                    caseId: caseData._id
                });

                socketService.emitNotification(caseData.citizenId._id, {
                    type: 'case_rejected',
                    title: 'Case Rejected (Incomplete)',
                    message: 'Your case was rejected due to NGO inactivity after 24 hours.',
                    caseId: caseData._id
                });
            }

            // Notify NGO
            if (assignedNGO) {
                await Notification.create({
                    userId: assignedNGO._id,
                    userModel: 'NGO',
                    type: 'system',
                    title: 'Case Auto-Rejected (Incomplete)',
                    message: `Case ${caseData._id} has been auto-rejected and added to your declined history because it exceeded the 24-hour completion limit.`,
                    caseId: caseData._id
                });

                socketService.emitNotification(assignedNGO._id, {
                    type: 'case_auto_closed',
                    title: 'Time Limit Exceeded',
                    message: 'Case auto-closed. Work was not completed within 24 hours.',
                    caseId: caseData._id
                });
            }

            // Notify Admins
            await notifyAdmins(
                caseData,
                'Stale Case Auto-Rejected',
                `Case ${caseData._id} in ${caseData.city} was auto-rejected after 24h inactivity by ${assignedNGO?.organizationName || 'assigned NGO'}`
            );
        }

    } catch (error) {
        logger.error('Error checking stale active cases:', error);
    }
};

/**
 * Check for pending cases that have not been accepted for over 2 hours
 * These are marked as closed (No NGO found)
 */
const checkFailedToAcceptCases = async () => {
    try {
        const now = new Date();
        const failureThreshold = new Date(now.getTime() - (2 * 60 * 60 * 1000)); // 2 hours ago

        const systemAdmin = await Admin.findOne({ isActive: true });
        if (!systemAdmin) return;

        const failedCases = await Case.find({
            status: 'pending',
            createdAt: { $lt: failureThreshold }
        }).populate('citizenId');

        if (failedCases.length > 0) {
            logger.info(`Found ${failedCases.length} pending cases not accepted for 2+ hours. Closing them.`);
        }

        for (const caseData of failedCases) {
            logger.warn(`Unaccepted case closure: ${caseData._id} - No response after 2 hours.`);

            // Update status to rejected
            caseData.updateStatus(
                'rejected',
                'Automated rejection: No NGO / Shelter found within 2 hours of reporting.',
                systemAdmin._id,
                'Admin'
            );

            // Explicitly set final report reason
            caseData.finalReport = 'No nearby NGO or Shelter was able to accept this case within the 2-hour response window.';

            await caseData.save();

            // Notify Citizen
            if (caseData.citizenId) {
                await Notification.create({
                    userId: caseData.citizenId._id,
                    userModel: 'Citizen',
                    type: 'case_update',
                    title: 'Case Rejected - No NGO Found',
                    message: `We're sorry, but no NGO or Shelter was available to accept your case in the last 2 hours. The case has been marked as rejected. Please try re-reporting if it's still an active emergency.`,
                    caseId: caseData._id
                });

                socketService.emitNotification(caseData.citizenId._id, {
                    type: 'case_rejected',
                    title: 'Case Rejected',
                    message: 'No NGO / Shelter found within 2 hours.',
                    caseId: caseData._id
                });
            }

            // Also notify admins that a case was missed
            await notifyAdmins(
                caseData,
                'Case Rejected - No Response',
                `Case ${caseData._id} in ${caseData.city} was auto-rejected as no NGO accepted it within 2 hours.`
            );
        }

    } catch (error) {
        logger.error('Error checking failed to accept cases:', error);
    }
};

/**
 * Manually trigger escalation for a case (can be called by admin)
 */
const manuallyEscalateCase = async (caseId) => {
    try {
        const caseData = await Case.findById(caseId);
        if (!caseData) {
            throw new Error('Case not found');
        }

        if (caseData.status !== 'pending') {
            throw new Error('Can only escalate pending cases');
        }

        await escalateCase(caseData);
        return { success: true, message: 'Case escalated successfully' };

    } catch (error) {
        logger.error('Manual escalation error:', error);
        throw error;
    }
};

/**
 * Check for cases that were accepted but no progress (Reached/Treating) reported in 2 hours
 * Sends a nudge/reminder to the NGO
 */
const checkAcceptedButNotReached = async () => {
    try {
        const now = new Date();
        const nudgeThreshold = new Date(now.getTime() - (2 * 60 * 60 * 1000)); // 2 hours ago

        const stagnantCases = await Case.find({
            status: 'accepted',
            acceptedAt: { $lt: nudgeThreshold },
            reachedAt: { $exists: false }
        }).populate('assignedNGO');

        for (const caseData of stagnantCases) {
            if (caseData.assignedNGO) {
                // Check if we already nudged them recently (prevent spam)
                const lastNudge = caseData.timeline.filter(e => e.status === 'nudge').pop();
                if (lastNudge && (now - new Date(lastNudge.timestamp)) < (60 * 60 * 1000)) continue;

                await Notification.create({
                    userId: caseData.assignedNGO._id,
                    userModel: 'NGO',
                    type: 'system',
                    title: '⏳ Rescue Reminder',
                    message: `You accepted Case ${caseData._id} 2 hours ago but haven't marked as 'Reached'. Please update status or help may be redirected.`,
                    caseId: caseData._id
                });

                socketService.emitNotification(caseData.assignedNGO._id, {
                    type: 'reminder',
                    title: '⏳ Rescue Reminder',
                    message: `Please update status for your accepted case in ${caseData.city}.`,
                    caseId: caseData._id
                });

                caseData.addTimelineEntry('nudge', 'Reminder sent to NGO for lack of progress', caseData.assignedNGO._id, 'NGO');
                await caseData.save();

                logger.info(`Nudged NGO ${caseData.assignedNGO.organizationName} for stagnant case ${caseData._id}`);
            }
        }
    } catch (error) {
        logger.error('Error checking stagnant accepted cases:', error);
    }
};

module.exports = {
    startEscalationMonitoring,
    escalateCase,
    manuallyEscalateCase,
    checkStaleActiveCases,
    checkFailedToAcceptCases,
    checkAcceptedButNotReached
};
