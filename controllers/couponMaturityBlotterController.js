const couponMaturityBlotterService = require('../services/couponMaturityBlotterService');

/**
 * GET /api/coupon-maturity-blotter
 * Get coupon maturity blotter data for a given coupon date
 */
exports.getCouponMaturityBlotter = async (req, res) => {
  try {
    const { startDate, endDate, counterparty } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'Start date and end date are required. Format: YYYY-MM-DD' 
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid date format. Use YYYY-MM-DD' 
      });
    }

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Start date cannot be after end date' 
      });
    }

    const data = await couponMaturityBlotterService.getCouponMaturityBlotter(startDate, endDate, counterparty);

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
      start_date: startDate,
      end_date: endDate
    });
  } catch (error) {
    console.error('Error fetching coupon maturity blotter:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to fetch coupon maturity blotter' 
    });
  }
};

