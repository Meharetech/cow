const mongoose = require('mongoose');

const caseSchema = new mongoose.Schema({
    // Case details
    condition: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        trim: true,
        default: 'General'
    },
    caseType: {
        type: String,
        enum: ['rescue', 'shelter', 'medical', 'emergency'],
        default: 'rescue',
        index: true
    },
    trackingId: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },


    // Location
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    address: {
        type: String,
        trim: true
    },
    landmark: {
        type: String,
        trim: true
    },
    city: {
        type: String,
        trim: true,
        index: true
    },
    state: {
        type: String,
        trim: true,
        index: true
    },

    // Media
    photoUrls: [{
        type: String
    }],
    videoUrl: {
        type: String
    },

    // Status tracking
    status: {
        type: String,
        enum: ['pending', 'accepted', 'reached', 'treating', 'assigned', 'in_progress', 'on_the_way', 'resolved', 'closed', 'rejected'],
        default: 'pending',
        index: true
    },

    // Relationships
    citizenId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Citizen',
        required: true,
        index: true
    },
    assignedNGO: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'NGO',
        index: true
    },

    // Declined tracking
    declinedBy: [{
        ngoId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'NGO',
            required: true
        },
        reason: {
            type: String,
            trim: true
        },
        declinedAt: {
            type: Date,
            default: Date.now
        }
    }],

    // Escalation tracking
    escalationLevel: {
        type: Number,
        default: 0,
        min: 0,
        max: 3
    },
    lastEscalatedAt: {
        type: Date
    },
    expiryTime: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    },
    needsAdminIntervention: {
        type: Boolean,
        default: false
    },


    // Timeline
    timeline: [{
        status: {
            type: String,
            required: true,
            enum: ['pending', 'accepted', 'reached', 'treating', 'assigned', 'in_progress',
                'on_the_way', 'resolved', 'closed', 'rejected', 'declined', 'escalated', 'nudge']
        },
        message: {
            type: String
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            refPath: 'timeline.refModel'
        },
        refModel: {
            type: String,
            required: true,
            enum: ['Admin', 'NGO', 'Citizen']
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],

    // Treatment details (filled by NGO)
    treatmentReport: {
        diagnosis: String,
        treatment: String,
        medications: String,
        notes: String,
        images: [String],
        updatedAt: Date
    },

    // Priority
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },

    // Metadata
    viewCount: {
        type: Number,
        default: 0
    },
    acceptedAt: {
        type: Date
    },
    reachedAt: {
        type: Date
    },
    assignedAt: {
        type: Date
    },
    resolvedAt: {
        type: Date
    },
    closedAt: {
        type: Date
    },

    // Treatment progress reports
    treatmentReports: [{
        reportedAt: {
            type: Date,
            default: Date.now
        },
        notes: {
            type: String,
            required: true
        },
        photos: [String],
        video: String,
        status: {
            type: String,
            enum: ['treating', 'stable', 'critical', 'improving']
        },
        reportedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'NGO',
            required: true
        }
    }],

    // Final report
    finalReport: {
        type: String
    }
}, {
    timestamps: true
});

// Indexes for performance
caseSchema.index({ location: '2dsphere' });
caseSchema.index({ status: 1, city: 1 });
caseSchema.index({ citizenId: 1, createdAt: -1 });
caseSchema.index({ assignedNGO: 1, status: 1 });
caseSchema.index({ createdAt: -1 });

// Add timeline entry
caseSchema.methods.addTimelineEntry = function (status, message, updatedBy, refModel) {
    this.timeline.push({
        status,
        message,
        updatedBy,
        refModel,
        timestamp: new Date()
    });
};

// Update status with timeline
caseSchema.methods.updateStatus = function (newStatus, message, updatedBy, refModel) {
    this.status = newStatus;
    this.addTimelineEntry(newStatus, message, updatedBy, refModel);

    // Update timestamps
    if (newStatus === 'assigned') {
        this.assignedAt = new Date();
    } else if (newStatus === 'resolved') {
        this.resolvedAt = new Date();
    } else if (newStatus === 'closed') {
        this.closedAt = new Date();
    }
};

// Generate readable tracking ID: STATE-CITY-YYYYMMDD-RANDOM
caseSchema.statics.generateTrackingId = async function (state, city) {
    const date = new Date();
    const dateStr = date.getFullYear().toString() +
        (date.getMonth() + 1).toString().padStart(2, '0') +
        date.getDate().toString().padStart(2, '0');

    // Get characters for prefix
    const statePrefix = (state || 'INDIA').substring(0, 4).toUpperCase();
    const cityPrefix = (city || 'GEN').substring(0, 3).toUpperCase();

    let isUnique = false;
    let finalId = '';

    while (!isUnique) {
        const random = Math.floor(1000 + Math.random() * 9000); // 4 digit serial
        finalId = `${statePrefix}-${cityPrefix}-${dateStr}-${random}`;

        const existing = await this.findOne({ trackingId: finalId });
        if (!existing) isUnique = true;
    }

    return finalId;
};

module.exports = mongoose.model('Case', caseSchema);
