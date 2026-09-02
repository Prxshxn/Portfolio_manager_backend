const express = require('express');
const router = express.Router();
const dailyTransactionBlotterController = require('../controllers/dailyTransactionBlotterController');

// GET /api/daily-transaction-blotter?date=YYYY-MM-DD
router.get('/', dailyTransactionBlotterController.getDailyTransactionBlotter);

module.exports = router;
