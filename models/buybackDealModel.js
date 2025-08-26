const db = require('../config/db');

const BuybackDeal = {
  // Create a new buyback deal
  create: async (dealData) => {
    const sql = `INSERT INTO buyback_deals (
      deal_number,
      leg1_trade_date, leg1_value_date, leg1_transaction_type, leg1_trade_type, leg1_isin,
      leg1_counterparty, leg1_broker, leg1_portfolio, leg1_strategy, leg1_custodian,
      leg1_settlement_mode, leg1_brokerage, leg1_interest_rate, leg1_face_value,
      leg1_yield_rate, leg1_settlement_amount, leg1_clean_price, leg1_dirty_price,
      leg1_accrued_interest, leg1_currency,
      leg2_trade_date, leg2_value_date, leg2_transaction_type, leg2_trade_type, leg2_isin,
      leg2_counterparty, leg2_portfolio, leg2_strategy, leg2_custodian, leg2_settlement_mode,
      leg2_face_value, leg2_yield_rate, leg2_settlement_amount, leg2_clean_price,
      leg2_dirty_price, leg2_accrued_interest, leg2_currency,
      issue_date, maturity_date, coupon_rate, coupon_date1, coupon_date2,
      deal_status, created_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      dealData.deal_number,
      // Leg 1
      dealData.leg1.tradeDate, dealData.leg1.valueDate, dealData.leg1.transactionType,
      dealData.leg1.tradeType, dealData.leg1.isin, dealData.leg1.counterparty,
      dealData.leg1.broker, dealData.leg1.portfolio, dealData.leg1.strategy,
      dealData.leg1.custodian, dealData.leg1.settlementMode, dealData.leg1.brokerage,
      dealData.leg1.interestRate, dealData.leg1.faceValue, dealData.leg1.yield,
      dealData.leg1.settlementAmount, dealData.leg1.cleanPrice, dealData.leg1.dirtyPrice,
      dealData.leg1.accruedInterest, dealData.leg1.currency,
      // Leg 2
      dealData.leg2.tradeDate, dealData.leg2.valueDate, dealData.leg2.transactionType,
      dealData.leg2.tradeType, dealData.leg2.isin, dealData.leg2.counterparty,
      dealData.leg2.portfolio, dealData.leg2.strategy, dealData.leg2.custodian,
      dealData.leg2.settlementMode, dealData.leg2.faceValue, dealData.leg2.yield,
      dealData.leg2.settlementAmount, dealData.leg2.cleanPrice, dealData.leg2.dirtyPrice,
      dealData.leg2.accruedInterest, dealData.leg2.currency,
      // ISIN metadata
      dealData.issueDate, dealData.maturityDate, dealData.couponRate,
      dealData.couponDate1, dealData.couponDate2,
      // Status and tracking
      dealData.deal_status || 'Pending_Verification',
      dealData.created_by,
      dealData.notes || null
    ];

    const [result] = await db.query(sql, values);
    return result;
  },

  // Get all buyback deals
  getAll: async () => {
    const sql = `SELECT 
      bd.*,
      creator.username as created_by_name,
      verifier.username as verified_by_name,
      approver.username as approved_by_name
    FROM buyback_deals bd
    LEFT JOIN users creator ON bd.created_by = creator.id
    LEFT JOIN users verifier ON bd.verified_by = verifier.id
    LEFT JOIN users approver ON bd.approved_by = approver.id
    ORDER BY bd.created_at DESC`;
    
    const [rows] = await db.query(sql);
    return rows;
  },

  // Get a single buyback deal by ID
  getById: async (id) => {
    const sql = `SELECT 
      bd.*,
      creator.username as created_by_name,
      verifier.username as verified_by_name,
      approver.username as approved_by_name
    FROM buyback_deals bd
    LEFT JOIN users creator ON bd.created_by = creator.id
    LEFT JOIN users verifier ON bd.verified_by = verifier.id
    LEFT JOIN users approver ON bd.approved_by = approver.id
    WHERE bd.id = ?`;
    
    const [rows] = await db.query(sql, [id]);
    return rows[0];
  },

  // Get buyback deals by status
  getByStatus: async (status) => {
    const sql = `SELECT 
      bd.*,
      creator.username as created_by_name,
      verifier.username as verified_by_name,
      approver.username as approved_by_name
    FROM buyback_deals bd
    LEFT JOIN users creator ON bd.created_by = creator.id
    LEFT JOIN users verifier ON bd.verified_by = verifier.id
    LEFT JOIN users approver ON bd.approved_by = approver.id
    WHERE bd.deal_status = ?
    ORDER BY bd.created_at DESC`;
    
    const [rows] = await db.query(sql, [status]);
    return rows;
  },

  // Update deal status
  updateStatus: async (id, status, userId, field = 'verified_by') => {
    const sql = `UPDATE buyback_deals 
                 SET deal_status = ?, ${field} = ?, ${field.replace('_by', '_at')} = NOW()
                 WHERE id = ?`;
    const [result] = await db.query(sql, [status, userId, id]);
    return result;
  },

  // Update deal
  update: async (id, dealData) => {
    const sql = `UPDATE buyback_deals SET
      leg1_trade_date = ?, leg1_value_date = ?, leg1_transaction_type = ?, leg1_isin = ?,
      leg1_counterparty = ?, leg1_broker = ?, leg1_portfolio = ?, leg1_strategy = ?,
      leg1_custodian = ?, leg1_settlement_mode = ?, leg1_brokerage = ?, leg1_interest_rate = ?,
      leg1_face_value = ?, leg1_yield_rate = ?, leg1_settlement_amount = ?, leg1_clean_price = ?,
      leg1_dirty_price = ?, leg1_accrued_interest = ?,
      leg2_trade_date = ?, leg2_value_date = ?, leg2_transaction_type = ?, leg2_isin = ?,
      leg2_counterparty = ?, leg2_portfolio = ?, leg2_strategy = ?, leg2_custodian = ?,
      leg2_settlement_mode = ?, leg2_face_value = ?, leg2_yield_rate = ?, leg2_settlement_amount = ?,
      leg2_clean_price = ?, leg2_dirty_price = ?, leg2_accrued_interest = ?,
      notes = ?, updated_at = NOW()
      WHERE id = ?`;

    const values = [
      // Leg 1
      dealData.leg1.tradeDate, dealData.leg1.valueDate, dealData.leg1.transactionType,
      dealData.leg1.isin, dealData.leg1.counterparty, dealData.leg1.broker,
      dealData.leg1.portfolio, dealData.leg1.strategy, dealData.leg1.custodian,
      dealData.leg1.settlementMode, dealData.leg1.brokerage, dealData.leg1.interestRate,
      dealData.leg1.faceValue, dealData.leg1.yield, dealData.leg1.settlementAmount,
      dealData.leg1.cleanPrice, dealData.leg1.dirtyPrice, dealData.leg1.accruedInterest,
      // Leg 2
      dealData.leg2.tradeDate, dealData.leg2.valueDate, dealData.leg2.transactionType,
      dealData.leg2.isin, dealData.leg2.counterparty, dealData.leg2.portfolio,
      dealData.leg2.strategy, dealData.leg2.custodian, dealData.leg2.settlementMode,
      dealData.leg2.faceValue, dealData.leg2.yield, dealData.leg2.settlementAmount,
      dealData.leg2.cleanPrice, dealData.leg2.dirtyPrice, dealData.leg2.accruedInterest,
      // Other
      dealData.notes,
      id
    ];

    const [result] = await db.query(sql, values);
    return result;
  },

  // Delete deal
  delete: async (id) => {
    const sql = 'DELETE FROM buyback_deals WHERE id = ?';
    const [result] = await db.query(sql, [id]);
    return result;
  },

  // Generate deal number
  generateDealNumber: async () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    
    // Get the count of deals created today
    const sql = `SELECT COUNT(*) as count FROM buyback_deals 
                 WHERE DATE(created_at) = CURDATE()`;
    const [rows] = await db.query(sql);
    const dailyCount = rows[0].count + 1;
    
    return `BB${dateStr}${dailyCount.toString().padStart(3, '0')}`;
  }
};

module.exports = BuybackDeal;
