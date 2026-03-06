const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');
const {
    validateCitizenRegistration,
    validateNGORegistration,
    validateLogin,
    validateOTPVerification
} = require('../middlewares/validation');

// Citizen routes
router.post('/citizen/register', validateCitizenRegistration, authController.registerCitizen);
router.post('/citizen/verify-otp', validateOTPVerification, authController.verifyOTP);
router.post('/citizen/resend-otp', authController.resendOTP);
router.post('/citizen/login', validateLogin, authController.loginCitizen);
router.post('/admin/login', validateLogin, authController.loginAdmin);
router.post('/citizen/forgot-password', authController.forgotPassword);
router.post('/citizen/reset-password', authController.resetPassword);


const upload = require('../middlewares/upload');

// NGO/Shelter routes
router.post('/ngo/register',
    upload.fields([
        { name: 'logo', maxCount: 1 },
        { name: 'certificate', maxCount: 1 },
        { name: 'facilityImages', maxCount: 10 }
    ]),
    validateNGORegistration,
    authController.registerNGO
);
router.post('/ngo/login', validateLogin, authController.loginNGO);
router.post('/ngo/forgot-password', authController.forgotPassword);
router.post('/ngo/reset-password', authController.resetPassword);

// Common routes
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.get('/profile', authenticate, authController.getProfile);
router.get('/me', authenticate, authController.getProfile);
router.put('/update-profile', authenticate, upload.single('profileImage'), authController.updateProfile);
router.post('/change-password', authenticate, authController.changePassword);

module.exports = router;
