const express = require('express');
const router = express.Router();
const issuerMasterController = require('../controllers/issuerMasterController');

router.get('/', issuerMasterController.getAllIssuers);
router.get('/:id', issuerMasterController.getIssuerById);
router.post('/', issuerMasterController.createIssuer);
router.put('/:id', issuerMasterController.updateIssuer);
router.delete('/:id', issuerMasterController.deleteIssuer);

module.exports = router;
