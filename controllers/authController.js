const Admin = require('../models/Admin');
const Citizen = require('../models/Citizen');
const NGO = require('../models/NGO');
const tokenService = require('../services/tokenService');
const emailService = require('../services/emailService');
const Notification = require('../models/Notification');
const logger = require('../utils/logger');

// Temporary storage for registration data before OTP verification
const registrationCache = new Map();

// Clean up expired registration data every hour to prevent memory leaks
setInterval(() => {
    const now = new Date();
    for (const [email, data] of registrationCache.entries()) {
        if (now > data.otpExpiresAt) {
            registrationCache.delete(email);
            logger.info(`Expired registration data cleared for: ${email}`);
        }
    }
}, 60 * 60 * 1000);

// Citizen Registration
exports.registerCitizen = async (req, res) => {
    try {
        const { name, mobile, email, password, dob, state, city, pincode, address } = req.body;

        // Check if user already exists in DB
        const [existingCitizen, existingAdmin, existingNGO] = await Promise.all([
            Citizen.findOne({ $or: [{ email }, { mobile }] }),
            Admin.findOne({ $or: [{ email }, { mobile }] }),
            NGO.findOne({ $or: [{ email }, { mobile }] })
        ]);

        const existingUser = existingCitizen || existingAdmin || existingNGO;

        if (existingUser) {
            let message = 'User already exists.';
            if (existingUser.email === email) {
                message = 'Email address already registered.';
            } else if (existingUser.mobile === mobile) {
                message = 'Mobile number already registered.';
            }

            return res.status(400).json({
                success: false,
                message: message
            });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + (process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000);

        // Store registration data in memory cache (Not DB)
        registrationCache.set(email, {
            userData: {
                role: 'citizen',
                name,
                mobile,
                email,
                password,
                dob,
                state,
                city,
                pincode,
                address,
                verificationStatus: 'approved' // Citizens are auto-approved once verified
            },
            otp,
            otpExpiresAt
        });

        // Send OTP email
        console.log(`\n-----------------------------------------`);
        console.log(`🔑 NEW REGISTRATION OTP (CACHED)`);
        console.log(`📧 EMAIL: ${email}`);
        console.log(`🔢 OTP: ${otp}`);
        console.log(`-----------------------------------------\n`);

        await emailService.sendOTP(email, otp, name);

        logger.info(`Citizen registration initiated (cached): ${email}`);

        res.status(201).json({
            success: true,
            message: 'Registration initiated. Please verify your email with the OTP sent.',
            data: {
                email: email,
                otpSent: true
            }
        });
    } catch (error) {
        logger.error('Citizen registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
};

// Verify OTP
exports.verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;
        let user;
        let isNewRegistration = false;

        // 1. Check registration cache first (for new registrations)
        const cachedData = registrationCache.get(email);

        if (cachedData) {
            // Verify OTP from cache
            if (cachedData.otp !== otp) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid OTP'
                });
            }

            if (new Date() > cachedData.otpExpiresAt) {
                return res.status(400).json({
                    success: false,
                    message: 'OTP has expired'
                });
            }

            // OTP valid! Save user to DB now.
            const userData = cachedData.userData;
            userData.isEmailVerified = true;

            if (userData.role === 'ngo' || userData.role === 'shelter') {
                userData.customId = await NGO.generateCustomId();
                user = new NGO(userData);
            } else {
                userData.customId = await Citizen.generateCustomId();
                user = new Citizen(userData);
            }

            await user.save();

            isNewRegistration = true;
            registrationCache.delete(email); // Remove from memory
        } else {
            // 2. Fallback to DB (for existing unverified users if any or password resets)
            // Search across models
            const [citizen, ngo] = await Promise.all([
                Citizen.findOne({ email }).select('+password +otp'),
                NGO.findOne({ email }).select('+password +otp')
            ]);

            user = citizen || ngo;

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found or registration session expired'
                });
            }

            if (user.isEmailVerified && !user.otp?.code) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already verified'
                });
            }

            // Verify OTP from DB
            if (!user.verifyOTP(otp)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired OTP'
                });
            }

            // Mark email as verified if it wasn't
            user.isEmailVerified = true;
            user.clearOTP();
            await user.save();
        }

        // Generate tokens
        const tokens = tokenService.generateTokenPair(user._id, user.role, user.email);

        // Save refresh token
        user.refreshToken = tokens.refreshToken;
        await user.save();

        // Send welcome email
        const displayName = user.name || user.organizationName || 'User';
        await emailService.sendWelcomeEmail(user.email, displayName, user.role);

        // Create welcome notification
        let welcomeTitle = 'Welcome to Cow Rescue!';
        let welcomeMessage = 'Your account has been verified successfully. You can now start reporting cases.';

        if (user.role === 'ngo' || user.role === 'shelter') {
            welcomeTitle = 'Email Verified!';
            welcomeMessage = 'Your email has been verified. Your organization profile is now pending admin verification. We will notify you once approved.';
        }

        const userModel = (user.role === 'ngo' || user.role === 'shelter') ? 'NGO' : 'Citizen';
        await Notification.createNotification(
            user._id,
            userModel,
            'system',
            welcomeTitle,
            welcomeMessage
        );

        logger.info(`Email verified and user created: ${email}`);

        res.json({
            success: true,
            message: 'Email verified successfully',
            data: {
                user: user.toJSON(),
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                isNewUser: isNewRegistration
            }
        });
    } catch (error) {
        logger.error('OTP verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Verification failed',
            error: error.message
        });
    }
};

// Resend OTP
exports.resendOTP = async (req, res) => {
    try {
        const { email } = req.body;

        // 1. Check registration cache first (for new unverified registrations)
        const cachedData = registrationCache.get(email);
        if (cachedData) {
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            cachedData.otp = otp;
            cachedData.otpExpiresAt = new Date(Date.now() + (process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000);

            const displayName = cachedData.userData.name || cachedData.userData.organizationName || 'User';

            console.log(`\n-----------------------------------------`);
            console.log(`🔄 RESENT REGISTRATION OTP (CACHED)`);
            console.log(`📧 EMAIL: ${email}`);
            console.log(`🔢 OTP: ${otp}`);
            console.log(`-----------------------------------------\n`);

            await emailService.sendOTP(email, otp, displayName);

            return res.json({
                success: true,
                message: 'New OTP sent to your email'
            });
        }

        // 2. Fallback to DB (for existing users who might need verification)
        const [citizen, ngo] = await Promise.all([
            Citizen.findOne({ email }).select('+otp'),
            NGO.findOne({ email }).select('+otp')
        ]);

        const user = citizen || ngo;

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found or registration session expired'
            });
        }

        if (user.isEmailVerified && !user.otp?.code) {
            return res.status(400).json({
                success: false,
                message: 'Email already verified'
            });
        }

        // Generate new OTP
        const otp = user.generateOTP();
        await user.save();

        // Send OTP email
        console.log(`\n-----------------------------------------`);
        console.log(`🔄 RESENT OTP (DB)`);
        console.log(`📧 EMAIL: ${email}`);
        console.log(`🔢 OTP: ${otp}`);
        console.log(`-----------------------------------------\n`);

        const displayName = user.name || user.organizationName || 'User';
        await emailService.sendOTP(email, otp, displayName);

        logger.info(`OTP resent to (DB): ${email}`);

        res.json({
            success: true,
            message: 'OTP sent successfully'
        });
    } catch (error) {
        logger.error('Resend OTP error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resend OTP',
            error: error.message
        });
    }
};

// Citizen Login
exports.loginCitizen = async (req, res) => {
    try {
        const { email, mobile, password } = req.body;

        // Find user by email or mobile
        const user = await Citizen.findOne({
            $or: [{ email }, { mobile }]
        }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check password
        const isPasswordValid = await user.comparePassword(password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check if email is verified
        if (!user.isEmailVerified) {
            const otpCode = user.generateOTP();
            await user.save();
            await emailService.sendOTP(user.email, otpCode, user.name);

            return res.status(403).json({
                success: false,
                message: 'Email not verified. A new OTP has been sent to your email.',
                requiresVerification: true,
                email: user.email
            });
        }

        // Check if account is active
        if (!user.isActive || user.isBlocked) {
            return res.status(403).json({
                success: false,
                message: 'Your account is inactive or blocked'
            });
        }

        // Generate tokens
        const tokens = tokenService.generateTokenPair(user._id, user.role, user.email);

        // Save refresh token
        user.refreshToken = tokens.refreshToken;
        user.lastLogin = new Date();
        user.loginCount += 1;
        await user.save();

        logger.info(`Citizen logged in: ${user.email}`);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: user.toJSON(),
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
};

// Admin Login
exports.loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        const user = await Admin.findOne({ email: normalizedEmail }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid admin credentials'
            });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid admin credentials'
            });
        }

        // Generate tokens
        const tokens = tokenService.generateTokenPair(user._id, user.role, user.email);

        // Update refresh token
        user.refreshToken = tokens.refreshToken;
        user.lastLogin = new Date();
        user.loginCount += 1;
        await user.save();

        logger.info(`Admin logged in: ${user.email}`);

        res.json({
            success: true,
            message: 'Admin login successful',
            data: {
                user: user.toJSON(),
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        });
    } catch (error) {
        logger.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Admin login failed',
            error: error.message
        });
    }
};

// NGO/Shelter Registration
exports.registerNGO = async (req, res) => {
    try {
        const {
            organizationName,
            registrationNumber,
            mobile,
            email,
            password,
            orgType,
            yearEstablished,
            capacity,
            state,
            city,
            pincode,
            address,
            website,
            gstNumber,
            panNumber,
            contactPersonName,
            contactPersonDesignation,
            contactPersonMobile
        } = req.body;

        // Check if user already exists in DB
        const [existingCitizen, existingAdmin, existingNGO] = await Promise.all([
            Citizen.findOne({ $or: [{ email }, { mobile }] }),
            Admin.findOne({ $or: [{ email }, { mobile }] }),
            NGO.findOne({ $or: [{ email }, { mobile }, { registrationNumber }] })
        ]);

        const existingUser = existingCitizen || existingAdmin || existingNGO;

        if (existingUser) {
            let message = 'Organization already exists.';
            if (existingUser.email === email) {
                message = 'Email address already registered.';
            } else if (existingUser.mobile === mobile) {
                message = 'Mobile number already registered.';
            } else if (existingUser.registrationNumber === registrationNumber) {
                message = 'Registration number already exists.';
            }

            return res.status(400).json({
                success: false,
                message: message
            });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + (process.env.OTP_EXPIRY_MINUTES || 10) * 60 * 1000);

        // Store registration data in memory cache (Not DB)
        registrationCache.set(email, {
            userData: {
                role: 'ngo',
                organizationName,
                registrationNumber,
                mobile,
                email,
                password,
                orgType,
                yearEstablished,
                capacity,
                state,
                city,
                pincode,
                address,
                website,
                gstNumber,
                panNumber,
                contactPerson: {
                    name: contactPersonName,
                    designation: contactPersonDesignation,
                    mobile: contactPersonMobile
                },
                logo: req.files['logo'] ? req.files['logo'][0].path.replace(/\\/g, '/') : undefined,
                registrationCertificate: req.files['certificate'] ? req.files['certificate'][0].path.replace(/\\/g, '/') : undefined,
                facilityImages: req.files['facilityImages'] ? req.files['facilityImages'].map(f => f.path.replace(/\\/g, '/')) : [],
                verificationStatus: 'pending', // NGOs need admin approval
                isEmailVerified: false
            },
            otp,
            otpExpiresAt
        });

        // Send OTP email
        console.log(`\n-----------------------------------------`);
        console.log(`🔑 NEW NGO REGISTRATION OTP (CACHED)`);
        console.log(`📧 EMAIL: ${email}`);
        console.log(`🔢 OTP: ${otp}`);
        console.log(`-----------------------------------------\n`);

        await emailService.sendOTP(email, otp, organizationName);

        logger.info(`NGO registration initiated (cached): ${email}`);

        res.status(201).json({
            success: true,
            message: 'Registration initiated. Please verify your email with the OTP sent.',
            data: {
                email: email,
                otpSent: true
            }
        });
    } catch (error) {
        logger.error('NGO registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
};

// NGO/Shelter Login
exports.loginNGO = async (req, res) => {
    try {
        const { email, mobile, password } = req.body;

        // Find NGO by email or mobile
        const ngo = await NGO.findOne({
            $or: [{ email }, { mobile }]
        }).select('+password');

        if (!ngo) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check password
        const isPasswordValid = await ngo.comparePassword(password);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check email verification
        if (!ngo.isEmailVerified) {
            const otpCode = ngo.generateOTP();
            await ngo.save();
            await emailService.sendOTP(ngo.email, otpCode, ngo.organizationName);

            return res.status(403).json({
                success: false,
                message: 'Email not verified. A new OTP has been sent to your email.',
                isEmailVerified: false,
                email: ngo.email
            });
        }

        // Check verification status
        if (ngo.verificationStatus === 'pending') {
            return res.status(403).json({
                success: false,
                message: 'Your account is pending admin verification',
                verificationStatus: 'pending'
            });
        }

        if (ngo.verificationStatus === 'rejected') {
            return res.status(403).json({
                success: false,
                message: 'Your account verification was rejected. Please contact support.',
                verificationStatus: 'rejected'
            });
        }

        // Check if account is active
        if (!ngo.isActive || ngo.isBlocked) {
            return res.status(403).json({
                success: false,
                message: 'Your account is inactive or blocked'
            });
        }

        // Generate tokens
        const tokens = tokenService.generateTokenPair(ngo._id, ngo.role, ngo.email);

        // Save refresh token
        ngo.refreshToken = tokens.refreshToken;
        ngo.lastLogin = new Date();
        ngo.loginCount += 1;
        await ngo.save();

        logger.info(`NGO logged in: ${ngo.organizationName}`);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: ngo.toJSON(),
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        });
    } catch (error) {
        logger.error('NGO login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
};

// Refresh Token
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token required'
            });
        }

        // Verify refresh token
        const { valid, decoded } = tokenService.verifyRefreshToken(refreshToken);

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired refresh token'
            });
        }

        // Find user and verify refresh token across all models
        const [citizen, ngo, admin] = await Promise.all([
            Citizen.findById(decoded.userId).select('+refreshToken'),
            NGO.findById(decoded.userId).select('+refreshToken'),
            Admin.findById(decoded.userId).select('+refreshToken')
        ]);

        const user = citizen || ngo || admin;

        if (!user || user.refreshToken !== refreshToken) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        // Generate new tokens
        const tokens = tokenService.generateTokenPair(user._id, user.role, user.email);

        // Update refresh token
        user.refreshToken = tokens.refreshToken;
        await user.save();

        logger.info(`Token refreshed for user: ${user._id}`);

        res.json({
            success: true,
            message: 'Token refreshed successfully',
            data: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken
            }
        });
    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            message: 'Token refresh failed',
            error: error.message
        });
    }
};

// Logout
exports.logout = async (req, res) => {
    try {
        const user = req.user;

        if (user) {
            user.refreshToken = null;
            await user.save();
        }

        logger.info(`User logged out: ${req.userId}`);

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Logout failed',
            error: error.message
        });
    }
};

// Get current user profile
exports.getProfile = async (req, res) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user.toJSON()
        });
    } catch (error) {
        logger.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile',
            error: error.message
        });
    }
};

// Update user profile
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.userId;
        const updates = req.body;

        // Find user (already in req.user from authenticate)
        const user = req.user;
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Handle profile image if uploaded
        if (req.file) {
            updates.profileImage = req.file.path.replace(/\\/g, '/');
        }

        // Role-specific field mapping if needed (contactPerson is nested)
        if (user.role === 'ngo' || user.role === 'shelter') {
            if (updates.contactPersonName || updates.contactPersonDesignation || updates.contactPersonMobile) {
                user.contactPerson = {
                    name: updates.contactPersonName || user.contactPerson.name,
                    designation: updates.contactPersonDesignation || user.contactPerson.designation,
                    mobile: updates.contactPersonMobile || user.contactPerson.mobile
                };
                delete updates.contactPersonName;
                delete updates.contactPersonDesignation;
                delete updates.contactPersonMobile;
            }

            // Handle GeoJSON Location updates
            if (updates.latitude !== undefined && updates.longitude !== undefined) {
                user.location = {
                    type: 'Point',
                    coordinates: [
                        parseFloat(updates.longitude),
                        parseFloat(updates.latitude)
                    ]
                };
                delete updates.latitude;
                delete updates.longitude;
            }
        }

        // Remove sensitive fields from updates just in case
        delete updates.password;
        delete updates.role;
        delete updates.email;
        delete updates.customId;

        // Apply remaining updates
        Object.assign(user, updates);
        await user.save();

        logger.info(`Profile updated for user: ${userId}`);

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: user.toJSON()
        });
    } catch (error) {
        logger.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: error.message
        });
    }
};

// Change Password
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.userId;

        let user;
        if (req.userRole === 'admin') {
            user = await Admin.findById(userId).select('+password');
        } else if (req.userRole === 'ngo' || req.userRole === 'shelter') {
            user = await NGO.findById(userId).select('+password');
        } else {
            user = await Citizen.findById(userId).select('+password');
        }
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify current password
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Incorrect current password'
            });
        }

        // Update password
        user.password = newPassword;
        await user.save();

        logger.info(`Password changed for user: ${userId}`);

        res.json({
            success: true,
            message: 'Password updated successfully'
        });
    } catch (error) {
        logger.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password',
            error: error.message
        });
    }
};

// Forgot Password - Initiate
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Find user by email across all models
        const [citizen, ngo, admin] = await Promise.all([
            Citizen.findOne({ email }),
            NGO.findOne({ email }),
            Admin.findOne({ email })
        ]);

        const user = citizen || ngo || admin;

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User with this email not found'
            });
        }

        // Generate reset OTP
        const otp = user.generateOTP();
        await user.save();

        // Send reset email
        console.log(`\n-----------------------------------------`);
        console.log(`🔑 PASSWORD RESET OTP`);
        console.log(`📧 EMAIL: ${email}`);
        console.log(`🔢 OTP: ${otp}`);
        console.log(`-----------------------------------------\n`);

        await emailService.sendPasswordResetOTP(email, otp, user.name);

        logger.info(`Password reset initiated for: ${email}`);

        res.json({
            success: true,
            message: 'Password reset OTP sent to your email'
        });
    } catch (error) {
        logger.error('Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to initiate password reset',
            error: error.message
        });
    }
};

// Reset Password - Complete
exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        // Find user across all models
        const [citizen, ngo, admin] = await Promise.all([
            Citizen.findOne({ email }).select('+password +otp'),
            NGO.findOne({ email }).select('+password +otp'),
            Admin.findOne({ email }).select('+password +otp')
        ]);

        const user = citizen || ngo || admin;

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify OTP
        if (!user.verifyOTP(otp)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP'
            });
        }

        // Update password
        user.password = newPassword;
        user.clearOTP();
        await user.save();

        logger.info(`Password reset completed for: ${email}`);

        res.json({
            success: true,
            message: 'Password reset successful. You can now login with your new password.'
        });
    } catch (error) {
        logger.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset password',
            error: error.message
        });
    }
};
