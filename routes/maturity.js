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

// Combined maturities for handling view (supports optional type/status filters)
// GET /api/maturity/handling?date=YYYY-MM-DD&type=all|gsec|money_market&status=all|pending|processed|failed
router.get('/handling', MaturityController.getMaturityHandling);

// Process selected maturities (stub implementation)
// POST /api/maturity/process { dealIds: number[], processType: string, processDate: YYYY-MM-DD }
router.post('/process', MaturityController.processMaturities);

// Export maturities (excel)
// GET /api/maturity/export?date=YYYY-MM-DD&type=...&status=...&format=excel|csv|pdf
router.get('/export', MaturityController.exportMaturities);

module.exports = router;
