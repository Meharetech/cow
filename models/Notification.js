const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    // Recipient
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'userModel',
        index: true
    },
    userModel: {
        type: String,
        required: true,
        enum: ['Admin', 'NGO', 'Citizen']
    },

    // Notification details
    type: {
        type: String,
        enum: [
            'case_new',
            'case_assigned',
            'case_accepted',
            'case_update',
            'ngo_arrived',
            'treatment_update',
            'case_resolved',
            'case_closed',
            'account_approved',
            'account_rejected',
            'system'
        ],
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },

    // Related data
    caseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Case'
    },

    // Status
    isRead: {
        type: Boolean,
        default: false,
        index: true
    },
    readAt: {
        type: Date
    },

    // Metadata
    data: {
        type: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: true
});

// Indexes
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

// Mark as read
notificationSchema.methods.markAsRead = function () {
    this.isRead = true;
    this.readAt = new Date();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function (userId, userModel, type, title, message, caseId = null, data = null) {
    return await this.create({
        userId,
        userModel,
        type,
        title,
        message,
        caseId,
        data
    });
};

module.exports = mongoose.model('Notification', notificationSchema);
