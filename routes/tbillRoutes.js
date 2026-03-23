const express = require('express');
const router = express.Router();
const tbillController = require('../controllers/tbillController');

router.post('/', tbillController.create);

module.exports = router;
