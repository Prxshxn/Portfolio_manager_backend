const express = require('express');
const router = express.Router();
const dealConfirmationController = require('../controllers/dealConfirmationController');
const { checkAuth, checkRoles } = require('../middleware/auth');

// Same access roles as the existing GSEC instruction letter feature.
const CONFIRMATION_ROLES = ['back_office_verifier', 'back_office_final', 'admin'];

router.get('/gsec/:id/pdf', checkAuth, checkRoles(...CONFIRMATION_ROLES), dealConfirmationController.getGsecConfirmationPdf);
router.get('/gsec/:id/docx', checkAuth, checkRoles(...CONFIRMATION_ROLES), dealConfirmationController.getGsecConfirmationDocx);

router.get('/buyback/:id/pdf', checkAuth, checkRoles(...CONFIRMATION_ROLES), dealConfirmationController.getBuybackConfirmationPdf);
router.get('/buyback/:id/docx', checkAuth, checkRoles(...CONFIRMATION_ROLES), dealConfirmationController.getBuybackConfirmationDocx);

router.get('/repo/:id/pdf', checkAuth, checkRoles(...CONFIRMATION_ROLES), dealConfirmationController.getRepoConfirmationPdf);
router.get('/repo/:id/docx', checkAuth, checkRoles(...CONFIRMATION_ROLES), dealConfirmationController.getRepoConfirmationDocx);

module.exports = router;
