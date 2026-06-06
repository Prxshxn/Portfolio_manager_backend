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
      tradeDate: tradeDate || valueDate,
      status: 'pending',
      current_approval_level: 'front_office'
    };

    const { insertId, dealNumber } = await Tbill.create(enriched);

    return res.status(201).json({
      success: true,
      message: 'T-Bill deal saved',
      data: { id: insertId, deal_number: dealNumber, dealNumber }
    });
  } catch (err) {
    console.error('tbill create error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to save T-Bill deal'
    });
  }
};

exports.getRecent = async (req, res) => {
  try {
    const transactions = await Tbill.getRecent();
    return res.json({ success: true, data: transactions });
  } catch (err) {
    console.error('tbill getRecent error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch T-Bill transactions'
    });
  }
};

exports.updateStatus = async (req, res) => {
  const id = req.params.id;
  const { status, comment, userId } = req.body || {};

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Must be approved or rejected.'
    });
  }

  try {
    const existing = await Tbill.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const updateData = {
      status,
      authorized_by: userId ? String(userId) : null
    };

    if (status === 'rejected' && typeof comment === 'string') {
      updateData.comment = comment;
    } else if (status === 'approved') {
      updateData.comment = null;
    }

    const result = await Tbill.updateStatus(id, updateData);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    return res.json({
      success: true,
      message: `Transaction ${status} successfully`,
      data: {
        status: result.status,
        current_approval_level: result.current_approval_level
      }
    });
  } catch (err) {
    console.error('tbill updateStatus error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update T-Bill status'
    });
  }
};

exports.update = async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};

  try {
    const existing = await Tbill.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const valueDate = body.valueDate || body.value_date || existing.value_date;
    const maturityDate = body.maturityDate || body.maturity_date || existing.maturity_date;
    const faceValue = body.faceValue ?? body.face_value ?? existing.face_value;
    const ratePct =
      body.discountRatePercent ??
      body.yield ??
      body.discount_rate_pct ??
      existing.discount_rate_pct;

    if (valueDate && maturityDate && faceValue != null && ratePct != null) {
      const priced = tbillPricing.compute({
        valueDate,
        maturityDate,
        faceValue,
        discountRatePercent: ratePct
      });

      if (!priced.ok) {
        return res.status(400).json({ success: false, message: priced.error || 'Pricing validation failed' });
      }

      body.daysToMaturity = priced.days;
      body.pricePer100 = priced.pricePer100;
      body.settlementAmount = priced.cashPrice;
      body.cleanPrice = priced.pricePer100;
      body.dirtyPrice = priced.pricePer100;
      body.discountRatePercent = ratePct;
    }

    const updatePayload = {
      ...body,
      status: body.status || 'pending',
      current_approval_level: body.current_approval_level || body.currentApprovalLevel || 'front_office'
    };

    const result = await Tbill.update(id, updatePayload);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    return res.json({
      success: true,
      message: 'T-Bill transaction updated successfully'
    });
  } catch (err) {
    console.error('tbill update error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update T-Bill transaction'
    });
  }
};
