const express = require('express');
const router = express.Router();
const counterpartyIndividualController = require('../controllers/counterpartyIndividualController');

// POST /api/counterparty-individual
router.post('/', counterpartyIndividualController.createCounterpartyIndividual);

// GET /api/counterparty-individual
router.get('/', counterpartyIndividualController.getAllCounterpartyIndividuals);

// GET /api/counterparty-individual/:id
router.get('/:id', counterpartyIndividualController.getCounterpartyIndividualById);

// PUT /api/counterparty-individual/:id
router.put('/:id', counterpartyIndividualController.updateCounterpartyIndividual);

module.exports = router;
