const express = require('express');
const router = express.Router();
const counterpartyJointController = require('../controllers/counterpartyJointController');

// POST /api/counterparty-joint
router.post('/', counterpartyJointController.createCounterpartyJoint);

// GET /api/counterparty-joint
router.get('/', counterpartyJointController.getAllCounterpartyJoints);

// GET /api/counterparty-joint/:id
router.get('/:id', counterpartyJointController.getCounterpartyJointById);

// PUT /api/counterparty-joint/:id
router.put('/:id', counterpartyJointController.updateCounterpartyJoint);

module.exports = router;
