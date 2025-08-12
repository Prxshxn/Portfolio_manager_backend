const express = require('express');
const router = express.Router();
const counterpartyController = require('../controllers/counterpartyController');

router.get('/', counterpartyController.getAllCounterparties);
router.get('/:id', counterpartyController.getCounterpartyById);


module.exports = router;
