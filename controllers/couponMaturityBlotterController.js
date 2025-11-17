const couponMaturityBlotterService = require('../services/couponMaturityBlotterService');

/**
 * GET /api/coupon-maturity-blotter
 * Get coupon maturity blotter data for a given coupon date
 */
exports.getCouponMaturityBlotter = async (req, res) => {
  try {
    const { couponDate, counterparty } = req.query;

    if (!couponDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'Coupon date is required. Format: YYYY-MM-DD' 
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(couponDate)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid date format. Use YYYY-MM-DD' 
      });
    }

    const data = await couponMaturityBlotterService.getCouponMaturityBlotter(couponDate, counterparty);

    // Calculate totals
    const totals = {
      buy: {
        count: data.filter(d => d.transaction_type === 'Buy').length,
        total_amount: data
          .filter(d => d.transaction_type === 'Buy')
          .reduce((sum, d) => sum + (d.coupon_amount || 0), 0)
      },
      sell: {
        count: data.filter(d => d.transaction_type === 'Sell').length,
        total_amount: data
          .filter(d => d.transaction_type === 'Sell')
          .reduce((sum, d) => sum + (d.coupon_amount || 0), 0)
      }
    };

    res.json({
      success: true,
      data,
      totals,
      coupon_date: couponDate
    });
  } catch (error) {
    console.error('Error fetching coupon maturity blotter:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to fetch coupon maturity blotter' 
    });
  }
};

