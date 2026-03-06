const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const citizenSchema = new mongoose.Schema({
    role: {
        type: String,
        default: 'citizen',
        immutable: true
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
    name: {
        type: String,
        trim: true
    },
    dob: {
        type: String
    },
    state: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    city: {
        type: String,
        required: true,
        trim: true,
        index: true
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
    language: {
        type: String,
        default: 'en'
    },
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
        enum: ['approved'],
        default: 'approved'
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
            type: [Number], // [longitude, latitude]
            default: [0, 0]
        }
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
    collection: 'citizens'
});

citizenSchema.index({ location: '2dsphere' });

citizenSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

citizenSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

citizenSchema.methods.generateOTP = function () {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    this.otp = {
        code: otp,
        expiresAt: new Date(Date.now() + (process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000)
    };
    return otp;
};

citizenSchema.methods.verifyOTP = function (otpCode) {
    if (!this.otp || !this.otp.code) return false;
    if (new Date() > this.otp.expiresAt) return false;
    return this.otp.code === otpCode;
};

citizenSchema.methods.clearOTP = function () {
    this.otp = undefined;
};

citizenSchema.statics.generateCustomId = async function () {
    let customId;
    let exists = true;
    while (exists) {
        customId = Math.floor(1000000 + Math.random() * 9000000).toString();
        exists = await this.exists({ customId });
    }
    return customId;
};

citizenSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    delete user.refreshToken;
    delete user.otp;
    delete user.__v;
    return user;
};

module.exports = mongoose.model('Citizen', citizenSchema);
