const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// GSec report endpoint
router.get('/gsec', reportController.getGsecReport);

// Portfolio report endpoint
router.get('/portfolio', reportController.getPortfolioReport);

// Counterparty report endpoint
router.get('/counterparty', reportController.getCounterpartyReport);
router.get('/counterparty-master', reportController.getCounterpartyMasterReport);

// Buyback report endpoint
router.get('/buyback', reportController.getBuybackReport);

module.exports = router;
