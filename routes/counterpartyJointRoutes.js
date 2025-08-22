const express = require('express');
const router = express.Router();
const counterpartyJointController = require('../controllers/counterpartyJointController');

// POST /api/counterparty-joint
router.post('/', counterpartyJointController.createCounterpartyJoint);

module.exports = router;
