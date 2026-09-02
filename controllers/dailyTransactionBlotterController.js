const dailyDealBlotterService = require('../services/dailyDealBlotterService');
const { getSystemDay } = require('../models/systemDayModel');

function toYmd(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function resolveDate(queryDate) {
  if (queryDate) return queryDate;
  const day = await getSystemDay();
  return toYmd(day && (day.system_date || day.systemDay));
}

/**
 * GET /api/daily-transaction-blotter
 * Deals whose value_date matches the selected (or system) day, with workflow-stop status.
 */
exports.getDailyTransactionBlotter = async (req, res) => {
  try {
    const date = await resolveDate(req.query.date);

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!date || !dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }

    const { deals, summary } = await dailyDealBlotterService.getDailyTransactionBlotter(date);

    res.json({
      success: true,
      date,
      date_axis: 'value_date',
      summary,
      data: deals
    });
  } catch (error) {
    console.error('Error fetching daily transaction blotter:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch daily transaction blotter'
    });
  }
};
