const express = require('express');
const router = express.Router();
const tbillController = require('../controllers/tbillController');

router.get('/recent', tbillController.getRecent);
router.post('/', tbillController.create);
router.put('/:id/status', tbillController.updateStatus);
router.put('/:id', tbillController.update);

module.exports = router;
