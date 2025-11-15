const express = require('express');
const router = express.Router();
const counterpartyCorporateController = require('../controllers/counterpartyCorporateController');

// POST /api/counterparty-corporate
router.post('/', counterpartyCorporateController.createCounterpartyCorporate);

// GET /api/counterparty-corporate
router.get('/', counterpartyCorporateController.getAllCounterpartyCorporates);

// GET /api/counterparty-corporate/:id
router.get('/:id', counterpartyCorporateController.getCounterpartyCorporateById);

// PUT /api/counterparty-corporate/:id
router.put('/:id', counterpartyCorporateController.updateCounterpartyCorporate);

module.exports = router;
