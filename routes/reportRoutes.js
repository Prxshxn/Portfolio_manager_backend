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

// Repo + Reverse Repo report endpoint
router.get('/repo', reportController.getRepoReport);

// T-Bill report endpoint
router.get('/tbill', reportController.getTbillReport);

module.exports = router;
