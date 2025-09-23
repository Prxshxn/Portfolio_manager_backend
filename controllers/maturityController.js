const MaturityController = {
  // Get money market maturities up to a specific date
  getMoneyMarketMaturities: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import the model dynamically to avoid circular dependencies
      const MoneyMarketDeal = require('../models/moneyMarketDealModel');
      
      const maturities = await MoneyMarketDeal.getMaturitiesByDate(selectedDate);
      
      res.json({
        success: true,
        data: maturities,
        message: `Found ${maturities.length} money market deals maturing up to ${date}`
      });

    } catch (error) {
      console.error('Error fetching money market maturities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch money market maturities: ' + error.message
      });
    }
  },

  // Get fixed income GSEC maturities up to a specific date
  getFixedIncomeGsecMaturities: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import the model dynamically to avoid circular dependencies
      const GsecDeal = require('../models/gsec');
      
      const maturities = await GsecDeal.getMaturitiesByDate(selectedDate);
      
      res.json({
        success: true,
        data: maturities,
        message: `Found ${maturities.length} GSEC deals maturing up to ${date}`
      });

    } catch (error) {
      console.error('Error fetching GSEC maturities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch GSEC maturities: ' + error.message
      });
    }
  },

  // Get maturity summary for both product types
  getMaturitySummary: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import models dynamically
      const MoneyMarketDeal = require('../models/moneyMarketDealModel');
      const GsecDeal = require('../models/gsec');
      
      // Get maturities for both product types
      const [moneyMarketMaturities, gsecMaturities] = await Promise.all([
        MoneyMarketDeal.getMaturitiesByDate(selectedDate),
        GsecDeal.getMaturitiesByDate(selectedDate)
      ]);

      // Calculate summary statistics
      const summary = {
        moneyMarket: {
          totalDeals: moneyMarketMaturities.length,
          totalPrincipal: moneyMarketMaturities.reduce((sum, deal) => sum + (parseFloat(deal.principal_amount) || 0), 0),
          deals7Days: moneyMarketMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 7;
          }).length,
          deals30Days: moneyMarketMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 30;
          }).length
        },
        gsec: {
          totalDeals: gsecMaturities.length,
          totalFaceValue: gsecMaturities.reduce((sum, deal) => sum + (parseFloat(deal.face_value) || 0), 0),
          deals7Days: gsecMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 7;
          }).length,
          deals30Days: gsecMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 30;
          }).length
        },
        total: {
          totalDeals: moneyMarketMaturities.length + gsecMaturities.length,
          totalValue: moneyMarketMaturities.reduce((sum, deal) => sum + (parseFloat(deal.principal_amount) || 0), 0) +
                     gsecMaturities.reduce((sum, deal) => sum + (parseFloat(deal.face_value) || 0), 0)
        }
      };
      
      res.json({
        success: true,
        data: summary,
        message: `Maturity summary for ${date}`
      });

    } catch (error) {
      console.error('Error fetching maturity summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch maturity summary: ' + error.message
      });
    }
  }
};

module.exports = MaturityController;

// Extended handlers for maturity handling, processing, and export
MaturityController.getMaturityHandling = async (req, res) => {
  try {
    const { date, type, status } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date parameter is required' });
    }
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const MoneyMarketDeal = require('../models/moneyMarketDealModel');
    const GsecDeal = require('../models/gsec');

    const wantMM = !type || type === 'all' || type === 'money_market';
    const wantGsec = !type || type === 'all' || type === 'gsec';

    const [mmRows, gsecRows] = await Promise.all([
      wantMM ? MoneyMarketDeal.getMaturitiesByDate(date) : Promise.resolve([]),
      wantGsec ? GsecDeal.getMaturitiesByDate(date) : Promise.resolve([])
    ]);

    // Map to common UI shape
    const mmMapped = (mmRows || []).map((row, idx) => ({
      id: row.id || row.deal_number || `mm-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'money_market',
      isin: row.isin || '',
      counterparty: row.counterparty_name || row.counterparty_id,
      face_value: row.principal_amount,
      maturity_date: row.maturity_date,
      days_to_maturity: row.days_to_maturity,
      status: row.deal_status || 'pending'
    }));
    const gsecMapped = (gsecRows || []).map((row, idx) => ({
      id: row.id || row.deal_number || `gsec-${idx}`,
      deal_number: row.deal_number || row.isin || `GSEC-${idx}`,
      deal_type: 'gsec',
      isin: row.isin,
      counterparty: row.counterparty_name || row.counterparty,
      face_value: row.face_value,
      maturity_date: row.maturity_date,
      days_to_maturity: row.days_to_maturity,
      status: row.deal_status || 'pending'
    }));

    let combined = [...mmMapped, ...gsecMapped];

    // Optional status filter
    if (status && status !== 'all') {
      combined = combined.filter(d => (d.status || '').toLowerCase() === status.toLowerCase());
    }

    return res.json({ success: true, data: combined });
  } catch (error) {
    console.error('Error fetching maturity handling data:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.processMaturities = async (req, res) => {
  try {
    const { dealIds, processType, processDate } = req.body || {};
    if (!Array.isArray(dealIds) || dealIds.length === 0) {
      return res.status(400).json({ success: false, error: 'dealIds array is required' });
    }
    if (!processType) {
      return res.status(400).json({ success: false, error: 'processType is required' });
    }
    // Stub: mark processed in-memory response. TODO: implement real processing logic per type.
    return res.json({ success: true, message: `Queued ${dealIds.length} deals for ${processType} on ${processDate || ''}` });
  } catch (error) {
    console.error('Error processing maturities:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.exportMaturities = async (req, res) => {
  try {
    const { date, type, status, format = 'excel' } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date parameter is required' });
    }
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const MoneyMarketDeal = require('../models/moneyMarketDealModel');
    const GsecDeal = require('../models/gsec');

    const wantMM = !type || type === 'all' || type === 'money_market';
    const wantGsec = !type || type === 'all' || type === 'gsec';

    const [mmRows, gsecRows] = await Promise.all([
      wantMM ? MoneyMarketDeal.getMaturitiesByDate(date) : Promise.resolve([]),
      wantGsec ? GsecDeal.getMaturitiesByDate(date) : Promise.resolve([])
    ]);
    // Map to exportable shape; reusing UI mapping keys where applicable
    let combined = [
      ...(mmRows || []).map((row, idx) => ({
        portfolio: '',
        custodian: '',
        deal_number: row.deal_number,
        face_value: row.principal_amount,
        value_date: row.value_date || '',
        maturity_date: row.maturity_date,
        isin: row.isin || '',
        coupon_interest: '',
        clean_price: '',
        nvp: '',
        yield: '',
        dtm: row.days_to_maturity,
        balance: row.principal_amount,
        available_balance: row.principal_amount,
        wap: '',
        repo_collateral: '',
        sell_back: '',
        counterparty: row.counterparty_name || row.counterparty_id
      })),
      ...(gsecRows || []).map((row, idx) => ({
        portfolio: row.portfolio || '',
        custodian: row.custodian || '',
        deal_number: row.deal_number || '',
        face_value: row.face_value,
        value_date: row.value_date || '',
        maturity_date: row.maturity_date,
        isin: row.isin,
        coupon_interest: row.coupon_interest || '',
        clean_price: row.clean_price || '',
        nvp: '',
        yield: row.yield || '',
        dtm: row.days_to_maturity,
        balance: row.face_value,
        available_balance: row.face_value,
        wap: '',
        repo_collateral: '',
        sell_back: '',
        counterparty: row.counterparty_name || row.counterparty
      }))
    ];
    if (status && status !== 'all') {
      // No status field in export rows; skip filter or map if available
    }
    const exporter = require('../utils/reportExporter');
    const buf = await exporter.export(format, combined);
    const mime = exporter.getMimeType(format);
    res.setHeader('Content-Type', mime);
    const dateStr = String(date);
    res.setHeader('Content-Disposition', `attachment; filename="maturity-handling-${dateStr}.${format === 'excel' ? 'xlsx' : format === 'csv' ? 'csv' : 'pdf'}"`);
    return res.status(200).send(buf);
  } catch (error) {
    console.error('Error exporting maturities:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};