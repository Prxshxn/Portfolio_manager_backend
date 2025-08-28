const express = require('express');
const router = express.Router();
const MaturityController = require('../controllers/maturityController');

// Get money market maturities up to a specific date
// GET /api/maturity/money-market?date=2024-01-31
router.get('/money-market', MaturityController.getMoneyMarketMaturities);

// Get fixed income GSEC maturities up to a specific date
// GET /api/maturity/fixed-income-gsec?date=2024-01-31
router.get('/fixed-income-gsec', MaturityController.getFixedIncomeGsecMaturities);

// Get maturity summary for both product types
// GET /api/maturity/summary?date=2024-01-31
router.get('/summary', MaturityController.getMaturitySummary);

module.exports = router;
