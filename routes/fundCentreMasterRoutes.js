const express = require('express');
const router = express.Router();
const fundCentreMasterController = require('../controllers/fundCentreMasterController');
const { checkAuth } = require('../middleware/auth');

// All routes require authentication
router.use(checkAuth);

// GET /api/fund-centre-master - Get all fund centres
router.get('/', fundCentreMasterController.getAllFundCentres);

// GET /api/fund-centre-master/:id - Get fund centre by ID
router.get('/:id', fundCentreMasterController.getFundCentreById);

// POST /api/fund-centre-master - Create a new fund centre
router.post('/', fundCentreMasterController.createFundCentre);

// PUT /api/fund-centre-master/:id - Update a fund centre
router.put('/:id', fundCentreMasterController.updateFundCentre);

// DELETE /api/fund-centre-master/:id - Delete a fund centre
router.delete('/:id', fundCentreMasterController.deleteFundCentre);

module.exports = router;
