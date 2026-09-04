const express = require('express');
const router = express.Router();
const buybackDealController = require('../controllers/buybackDealController');
const { checkAuth } = require('../middleware/auth');

// Create a new buyback deal
router.post('/', checkAuth, buybackDealController.createDeal);

// Get all buyback deals
router.get('/', checkAuth, buybackDealController.getAllDeals);

// Get deals by status
router.get('/status/:status', checkAuth, buybackDealController.getDealsByStatus);

// Get a specific buyback deal
router.get('/:id', checkAuth, buybackDealController.getDealById);

// Update deal status (verification/approval)
router.patch('/:id/status', checkAuth, buybackDealController.updateDealStatus);

// Update deal data
router.put('/:id', checkAuth, buybackDealController.updateDeal);

// Delete deal
router.delete('/:id', checkAuth, buybackDealController.deleteDeal);

module.exports = router;
