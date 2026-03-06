const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ngoSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['ngo', 'shelter'],
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
    organizationName: {
        type: String,
        required: true,
        trim: true
    },
    registrationNumber: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    orgType: {
        type: String,
        enum: ['NGO', 'Animal Shelter'],
        required: true
    },
    state: {
        type: String,
        required: true,
        trim: true
    },
    city: {
        type: String,
        required: true,
        trim: true
    },
    pincode: {
        type: String,
        required: true,
        trim: true
    },
    address: {
        type: String,
        required: true,
        trim: true
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
    contactPerson: {
        name: String,
        designation: String,
        mobile: String
    },
    verificationStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    isMobileVerified: {
        type: Boolean,
        default: false
    },
    otp: {
        code: String,
        expiresAt: Date
    },
    refreshToken: {
        type: String,
        select: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            default: [0, 0]
        }
    },
    landmark: {
        type: String,
        trim: true
    },
    lastLogin: {
        type: Date
    },
    loginCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    collection: 'ngos'
});

ngoSchema.index({ location: '2dsphere' });

ngoSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

ngoSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

ngoSchema.methods.generateOTP = function () {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.otp = {
        code: otp,
        expiresAt: new Date(Date.now() + (process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000)
    };
    return otp;
};

ngoSchema.methods.verifyOTP = function (otpCode) {
    if (!this.otp || !this.otp.code) return false;
    if (new Date() > this.otp.expiresAt) return false;
    return this.otp.code === otpCode;
};

ngoSchema.methods.clearOTP = function () {
    this.otp = undefined;
};

ngoSchema.statics.generateCustomId = async function () {
    let customId;
    let exists = true;
    while (exists) {
        customId = Math.floor(1000000 + Math.random() * 9000000).toString();
        exists = await this.exists({ customId });
    }
    return customId;
};

ngoSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    delete user.refreshToken;
    delete user.otp;
    delete user.__v;
    return user;
};

module.exports = mongoose.model('NGO', ngoSchema);
