const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const repoDealController = require('../controllers/repoDealController');

// Create new repo deal
router.post('/', auth, repoDealController.create);

// Get all repo deals with optional filters
router.get('/', auth, repoDealController.getAll);

// Get repo deal by ID
router.get('/:id', auth, repoDealController.getById);

// Update repo deal
router.put('/:id', auth, repoDealController.update);

// Delete repo deal
router.delete('/:id', auth, repoDealController.delete);

// Update deal status
router.patch('/:id/status', auth, repoDealController.updateStatus);

// Get repo deals by counterparty
router.get('/counterparty/:counterpartyId', auth, repoDealController.getByCounterparty);

// Get repo deals by ISIN
router.get('/isin/:isinNumber', auth, repoDealController.getByIsin);

// Get active repo deals
router.get('/status/active', auth, repoDealController.getActive);

// Get expiring repo deals
router.get('/expiring/soon', auth, repoDealController.getExpiringSoon);

// Get summary statistics
router.get('/summary/stats', auth, repoDealController.getSummary);

module.exports = router;
