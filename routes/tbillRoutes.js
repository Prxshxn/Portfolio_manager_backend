const express = require('express');
const router = express.Router();
const tbillController = require('../controllers/tbillController');
const { checkAuth } = require('../middleware/auth');

router.get('/recent', tbillController.getRecent);
router.get('/buy-deals', tbillController.getBuyDealsWithBalance);
router.post('/', tbillController.create);
router.put('/:id/status', checkAuth, tbillController.updateStatus);
router.put('/:id', tbillController.update);

module.exports = router;
