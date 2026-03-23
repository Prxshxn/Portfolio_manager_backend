const Tbill = require('../models/tbillModel');
const tbillPricing = require('../services/tbillPricingService');

exports.create = async (req, res) => {
  try {
    const body = req.body || {};

    const {
      tradeDate,
      valueDate,
      maturityDate,
      faceValue,
      yield: yieldField,
      discountRatePercent
    } = body;

    if (!valueDate || !maturityDate || !faceValue || (yieldField == null && discountRatePercent == null)) {
      return res.status(400).json({
        success: false,
        message: 'valueDate, maturityDate, faceValue, and yield (discount rate %) are required'
      });
    }

    const ratePct = discountRatePercent != null ? discountRatePercent : yieldField;
    const priced = tbillPricing.compute({
      valueDate,
      maturityDate,
      faceValue,
      discountRatePercent: ratePct
    });

    if (!priced.ok) {
      return res.status(400).json({ success: false, message: priced.error || 'Pricing validation failed' });
    }

    const enriched = {
      ...body,
      daysToMaturity: priced.days,
      pricePer100: priced.pricePer100,
      settlementAmount: priced.cashPrice,
      cleanPrice: priced.pricePer100,
      dirtyPrice: priced.pricePer100,
      discountRatePercent: ratePct,
      tradeDate: tradeDate || valueDate
    };

    const { insertId } = await Tbill.create(enriched);

    return res.status(201).json({
      success: true,
      message: 'T-Bill deal saved',
      data: { id: insertId }
    });
  } catch (err) {
    console.error('tbill create error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to save T-Bill deal'
    });
  }
};
