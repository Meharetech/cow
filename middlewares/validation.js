const { body, param, query, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

// Citizen Registration Validation
const validateCitizenRegistration = [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('mobile').trim().isLength({ min: 10, max: 10 }).withMessage('Mobile must be 10 digits'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('dob').optional().trim(),
    body('state').trim().notEmpty().withMessage('State is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('pincode').optional().trim().isLength({ min: 6, max: 6 }).withMessage('Pincode must be 6 digits'),
    body('address').optional().trim(),
    handleValidationErrors
];

// NGO Registration Validation
const validateNGORegistration = [
    body('organizationName').trim().notEmpty().withMessage('Organization name is required'),
    body('registrationNumber').trim().notEmpty().withMessage('Registration number is required'),
    body('mobile').trim().isLength({ min: 10, max: 10 }).withMessage('Mobile must be 10 digits'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('orgType').trim().isIn(['NGO', 'Animal Shelter']).withMessage('Invalid organization type. Must be NGO or Animal Shelter'),
    body('state').trim().notEmpty().withMessage('State is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('address').trim().notEmpty().withMessage('Address is required'),
    body('pincode').trim().isLength({ min: 6, max: 6 }).withMessage('Pincode must be 6 digits'),
    body('contactPersonName').trim().notEmpty().withMessage('Contact person name is required'),
    body('contactPersonMobile').trim().isLength({ min: 10, max: 10 }).withMessage('Contact mobile must be 10 digits'),
    handleValidationErrors
];

// Login Validation
const validateLogin = [
    body('email').optional().trim().isEmail().withMessage('Valid email is required'),
    body('mobile').optional().trim().isLength({ min: 10, max: 10 }).withMessage('Mobile must be 10 digits'),
    body('password').notEmpty().withMessage('Password is required'),
    handleValidationErrors
];

// OTP Verification Validation
const validateOTPVerification = [
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    handleValidationErrors
];

// Case Report Validation
const validateCaseReport = [
    body('condition').trim().notEmpty().withMessage('Condition is required'),
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    body('address').optional().trim(),
    body('landmark').optional().trim(),
    body('photoUrls').optional().isArray().withMessage('Photo URLs must be an array'),
    body('videoUrl').optional().trim(),
    handleValidationErrors
];

// Case Status Update Validation
const validateCaseStatusUpdate = [
    param('id').isMongoId().withMessage('Invalid case ID'),
    body('status').isIn(['assigned', 'in_progress', 'on_the_way', 'resolved', 'closed', 'rejected']).withMessage('Invalid status'),
    body('message').optional().trim(),
    handleValidationErrors
];

// Nearby Cases Query Validation
const validateNearbyCasesQuery = [
    query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    query('radius').optional().isInt({ min: 1, max: 100 }).withMessage('Radius must be between 1 and 100 km'),
    handleValidationErrors
];

// MongoDB ID Validation
const validateMongoId = (paramName = 'id') => [
    param(paramName).isMongoId().withMessage('Invalid ID'),
    handleValidationErrors
];

module.exports = {
    handleValidationErrors,
    validateCitizenRegistration,
    validateNGORegistration,
    validateLogin,
    validateOTPVerification,
    validateCaseReport,
    validateCaseStatusUpdate,
    validateNearbyCasesQuery,
    validateMongoId
};
