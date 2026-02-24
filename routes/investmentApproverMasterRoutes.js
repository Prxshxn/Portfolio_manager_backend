const express = require('express');
const router = express.Router();
const controller = require('../controllers/investmentApproverMasterController');

router.get('/', controller.getAllApprovers);
router.get('/:id', controller.getApproverById);
router.post('/', controller.createApprover);
router.put('/:id', controller.updateApprover);
router.delete('/:id', controller.deleteApprover);

module.exports = router;

