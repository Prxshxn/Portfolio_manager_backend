const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// GSec report endpoint
router.get('/gsec', reportController.getGsecReport);

// Portfolio report endpoint
router.get('/portfolio', reportController.getPortfolioReport);

module.exports = router;
