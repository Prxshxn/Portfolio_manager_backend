const dailyDealBlotterService = require('../services/dailyDealBlotterService');

function todayDateString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

/**
 * GET /api/daily-deal-blotter
 * Get all deals done on a given date (defaults to today) across every deal type,
 * along with each deal's current status.
 */
exports.getDailyDealBlotter = async (req, res) => {
  try {
    const date = req.query.date || todayDateString();

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    const { deals, summary } = await dailyDealBlotterService.getDailyDealBlotter(date);

    res.json({
      success: true,
      date,
      summary,
      data: deals
    });
  } catch (error) {
    console.error('Error fetching daily deal blotter:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch daily deal blotter'
    });
  }
};
