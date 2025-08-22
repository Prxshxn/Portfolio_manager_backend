const express = require('express');
const router = express.Router();
const counterpartyIndividualController = require('../controllers/counterpartyIndividualController');

// POST /api/counterparty-individual
router.post('/', counterpartyIndividualController.createCounterpartyIndividual);

// GET /api/counterparty-individual
router.get('/', counterpartyIndividualController.getAllCounterpartyIndividuals);

module.exports = router;
