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
