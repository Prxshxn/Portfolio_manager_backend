const express = require('express');
const router = express.Router();
const counterpartyCorporateController = require('../controllers/counterpartyCorporateController');

// POST /api/counterparty-corporate
router.post('/', counterpartyCorporateController.createCounterpartyCorporate);

// GET /api/counterparty-corporate
router.get('/', counterpartyCorporateController.getAllCounterpartyCorporates);

module.exports = router;
