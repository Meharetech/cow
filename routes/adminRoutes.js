const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middlewares/auth');

// All routes here require admin privileges
router.use(authenticate);
router.use(authorize('admin'));

router.get('/users', adminController.getAllUsers);
router.put('/users/:userId', adminController.updateUser);
router.delete('/users/:userId', adminController.deleteUser);

// Case management routes
router.put('/cases/:id/override', adminController.overrideCase);

module.exports = router;
