const express = require('express');
const router = express.Router();
const buybackDealController = require('../controllers/buybackDealController');

// Create a new buyback deal
router.post('/', buybackDealController.createDeal);

// Get all buyback deals
router.get('/', buybackDealController.getAllDeals);

// Get deals by status
router.get('/status/:status', buybackDealController.getDealsByStatus);

// Get a specific buyback deal
router.get('/:id', buybackDealController.getDealById);

// Update deal status (verification/approval)
router.patch('/:id/status', buybackDealController.updateDealStatus);

// Update deal data
router.put('/:id', buybackDealController.updateDeal);

// Delete deal
router.delete('/:id', buybackDealController.deleteDeal);

module.exports = router;
