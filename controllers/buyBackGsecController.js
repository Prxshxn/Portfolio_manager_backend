const db = require('../config/database');
const Gsec = require('../models/gsec'); // You may want a separate model later, but start with this for structure

module.exports = {
  /**
   * Save Buy Back Gsec transaction (separate logic from main Gsec)
   * POST /api/buyback-gsec
   */
  saveBuyBackGsec: async (req, res) => {
    try {
      // Extract fields from request body
      const {
        trade_date,
        transaction_type,
        isin,
        counterparty,
        face_value,
        accrued_interest,
        clean_price,
        dirty_price,
        status,
        portfolio,
        strategy,
        buyback_type, // ABS or ABC
        // ...add any new or custom fields for buyback here
      } = req.body;

      // TODO: Add buyback-specific validation or logic here

      // Insert into gsec table (or a separate table if you want)
      const result = await db.query(
        `INSERT INTO gsec (
          trade_date, transaction_type, isin, counterparty, face_value, accrued_interest, clean_price, dirty_price, status, portfolio, strategy, buyback_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [trade_date, transaction_type, isin, counterparty, face_value, accrued_interest, clean_price, dirty_price, status, portfolio, strategy, buyback_type]
      );

      res.json({ success: true, message: 'Buy Back Gsec transaction saved', id: result.insertId });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  /**
   * Get recent Buy Back Gsec transactions
   * GET /api/buyback-gsec/recent
   */
  getRecentBuyBackGsecTransactions: async (req, res) => {
    try {
      // You can filter by buyback_type if needed
      const { buyback_type } = req.query;
      let query = 'SELECT * FROM gsec WHERE 1=1';
      let params = [];
      if (buyback_type) {
        query += ' AND buyback_type = ?';
        params.push(buyback_type);
      }
      // Add any custom filters for buyback
      query += ' ORDER BY trade_date DESC LIMIT 50';
      const [transactions] = await db.query(query, params);
      res.json({ success: true, data: transactions });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // Add more buyback-specific endpoints as needed
};
