const tokenService = require('../services/tokenService');
const Admin = require('../models/Admin');
const Citizen = require('../models/Citizen');
const NGO = require('../models/NGO');
const logger = require('../utils/logger');

// Verify JWT token
const authenticate = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        const { valid, decoded, error } = tokenService.verifyAccessToken(token);

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token',
                error
            });
        }

        // Check if user exists and is active based on role in token
        let user;
        if (decoded.role === 'admin') {
            user = await Admin.findById(decoded.userId).select('-password -refreshToken');
        } else if (decoded.role === 'ngo' || decoded.role === 'shelter') {
            user = await NGO.findById(decoded.userId).select('-password -refreshToken');
        } else {
            user = await Citizen.findById(decoded.userId).select('-password -refreshToken');
        }

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        if (!user.isActive || user.isBlocked) {
            return res.status(403).json({
                success: false,
                message: 'Account is inactive or blocked'
            });
        }

        // Attach user to request
        req.user = user;
        req.userId = decoded.userId;
        req.userRole = decoded.role;

        next();
    } catch (error) {
        logger.error('Authentication error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication failed',
            error: error.message
        });
    }
};

// Role-based authorization
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Insufficient permissions.'
            });
        }

        next();
    };
};

// Check if NGO is verified
const checkNGOVerification = (req, res, next) => {
    if (req.user.role === 'ngo' || req.user.role === 'shelter') {
        if (req.user.verificationStatus !== 'approved') {
            return res.status(403).json({
                success: false,
                message: 'Your account is pending admin verification'
            });
        }
    }
    next();
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const { valid, decoded } = tokenService.verifyAccessToken(token);

            if (valid) {
                let user;
                if (decoded.role === 'admin') {
                    user = await Admin.findById(decoded.userId).select('-password -refreshToken');
                } else if (decoded.role === 'ngo' || decoded.role === 'shelter') {
                    user = await NGO.findById(decoded.userId).select('-password -refreshToken');
                } else {
                    user = await Citizen.findById(decoded.userId).select('-password -refreshToken');
                }

                if (user && user.isActive && !user.isBlocked) {
                    req.user = user;
                    req.userId = decoded.userId;
                    req.userRole = decoded.role;
                }
            }
        }

        next();
    } catch (error) {
        // Continue without authentication
        next();
    }
};

module.exports = {
    authenticate,
    authorize,
    checkNGOVerification,
    optionalAuth
};
