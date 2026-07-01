const express = require('express');
const router = express.Router();
const dailyDealBlotterController = require('../controllers/dailyDealBlotterController');

// GET /api/daily-deal-blotter?date=YYYY-MM-DD
router.get('/', dailyDealBlotterController.getDailyDealBlotter);

module.exports = router;
