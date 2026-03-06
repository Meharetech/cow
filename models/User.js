const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    // Common fields
    role: {
        type: String,
        enum: ['citizen', 'ngo', 'shelter', 'admin'],
        required: true,
        index: true
    },
    customId: {
        type: String,
        unique: true,
        sparse: true,
        index: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    mobile: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    profileImage: {
        type: String
    },

    // Citizen-specific fields
    name: {
        type: String,
        trim: true
    },
    dob: {
        type: String
    },
    state: {
        type: String,
        trim: true,
        index: true
    },
    city: {
        type: String,
        trim: true,
        index: true
    },
    pincode: {
        type: String,
        trim: true
    },
    address: {
        type: String,
        trim: true
    },
    language: {
        type: String,
        default: 'en'
    },

    // NGO/Shelter-specific fields
    organizationName: {
        type: String,
        trim: true
    },
    registrationNumber: {
        type: String,
        trim: true,
        sparse: true,
        unique: true
    },
    orgType: {
        type: String,
        enum: ['NGO', 'Animal Shelter']
    },
    yearEstablished: {
        type: String
    },
    capacity: {
        type: Number
    },
    website: {
        type: String
    },
    gstNumber: {
        type: String
    },
    panNumber: {
        type: String
    },
    logo: {
        type: String
    },
    registrationCertificate: {
        type: String
    },
    facilityImages: [String],

    // Contact person details (for NGO/Shelter)
    contactPerson: {
        name: String,
        designation: String,
        mobile: String
    },

    // Verification & Status
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    isMobileVerified: {
        type: Boolean,
        default: false
    },
    verificationStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: function () {
            return this.role === 'citizen' ? 'approved' : 'pending';
        }
    },

    // Documents (for NGO/Shelter)
    documents: {
        logo: String,
        registrationCertificate: String,
        facilityImages: [String]
    },

    // OTP
    otp: {
        code: String,
        expiresAt: Date
    },

    // Refresh Token
    refreshToken: {
        type: String,
        select: false
    },

    // Account status
    isActive: {
        type: Boolean,
        default: true
    },
    isBlocked: {
        type: Boolean,
        default: false
    },

    // Location for geospatial queries
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            default: [0, 0]
        }
    },

    // Metadata
    lastLogin: {
        type: Date
    },
    loginCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Indexes for performance
userSchema.index({ location: '2dsphere' });
userSchema.index({ role: 1, city: 1 });
userSchema.index({ verificationStatus: 1 });
userSchema.index({ createdAt: -1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Generate OTP
userSchema.methods.generateOTP = function () {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.otp = {
        code: otp,
        expiresAt: new Date(Date.now() + process.env.OTP_EXPIRY_MINUTES * 60 * 1000)
    };
    return otp;
};

// Verify OTP
userSchema.methods.verifyOTP = function (otpCode) {
    if (!this.otp || !this.otp.code) return false;
    if (new Date() > this.otp.expiresAt) return false;
    return this.otp.code === otpCode;
};

// Clear OTP
userSchema.methods.clearOTP = function () {
    this.otp = undefined;
};

// Generate unique 7-digit ID
userSchema.statics.generateCustomId = async function () {
    let customId;
    let exists = true;
    while (exists) {
        customId = Math.floor(1000000 + Math.random() * 9000000).toString();
        exists = await this.exists({ customId });
    }
    return customId;
};

// To JSON - remove sensitive data
userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    delete user.refreshToken;
    delete user.otp;
    delete user.__v;
    return user;
};

module.exports = mongoose.model('User', userSchema);
