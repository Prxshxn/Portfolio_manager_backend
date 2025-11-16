const express = require('express');
const router = express.Router();
const couponMaturityBlotterController = require('../controllers/couponMaturityBlotterController');

// GET /api/coupon-maturity-blotter
router.get('/', couponMaturityBlotterController.getCouponMaturityBlotter);

module.exports = router;

