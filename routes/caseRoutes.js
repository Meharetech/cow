const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const workflowController = require('../controllers/caseWorkflowController');
const { authenticate, authorize, checkNGOVerification } = require('../middlewares/auth');
const {
    validateCaseReport,
    validateCaseStatusUpdate,
    validateNearbyCasesQuery,
    validateMongoId
} = require('../middlewares/validation');

const upload = require('../middlewares/upload');

// Citizen routes
router.post(
    '/',
    authenticate,
    authorize('citizen'),
    upload.fields([
        { name: 'photos', maxCount: 5 },
        { name: 'video', maxCount: 1 }
    ]),
    validateCaseReport,
    caseController.createCase
);

router.get(
    '/my-reports',
    authenticate,
    authorize('citizen'),
    caseController.getMyReports
);

router.delete(
    '/:id',
    authenticate,
    authorize('citizen', 'admin'),
    validateMongoId('id'),
    caseController.deleteCase
);

// NGO routes
router.get(
    '/',
    authenticate,
    authorize('ngo', 'shelter', 'admin'),
    checkNGOVerification,
    caseController.getCases
);

router.get(
    '/nearby',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    validateNearbyCasesQuery,
    caseController.getNearbyCases
);

router.get(
    '/my-accepted',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    caseController.getMyAcceptedCases
);

router.get(
    '/stats',
    authenticate,
    authorize('ngo', 'shelter'),
    caseController.getNGOStats
);

router.get(
    '/declined',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    caseController.getDeclinedCases
);

router.patch(
    '/:id/accept',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    validateMongoId('id'),
    caseController.acceptCase
);

router.post(
    '/:id/decline',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    validateMongoId('id'),
    caseController.declineCase
);


router.patch(
    '/:id/status',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    validateCaseStatusUpdate,
    caseController.updateCaseStatus
);

router.post(
    '/:id/reassign',
    authenticate,
    authorize('ngo', 'shelter', 'admin'),
    validateMongoId('id'),
    caseController.reassignCase
);


// Enhanced workflow routes
router.get(
    '/workflow/nearby-enhanced',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    workflowController.getEnhancedNearbyCases
);

router.post(
    '/:id/workflow/accept',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    validateMongoId('id'),
    workflowController.acceptCaseWithTransaction
);

router.patch(
    '/:id/workflow/mark-reached',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    validateMongoId('id'),
    workflowController.markAsReached
);

router.post(
    '/:id/workflow/treatment-update',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    upload.fields([
        { name: 'photos', maxCount: 10 },
        { name: 'video', maxCount: 1 }
    ]),
    validateMongoId('id'),
    workflowController.addTreatmentUpdate
);

router.post(
    '/:id/workflow/close',
    authenticate,
    authorize('ngo', 'shelter'),
    checkNGOVerification,
    validateMongoId('id'),
    workflowController.closeCase
);

// Common routes
router.get(
    '/:id',
    authenticate,
    validateMongoId('id'),
    caseController.getCaseById
);

module.exports = router;
