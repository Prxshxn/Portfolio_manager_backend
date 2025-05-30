const db = require('../config/db');

const LimitSetup = {
  getAllCounterparties: async () => {
    const sql = `
      SELECT id, short_name AS name, 'individual' AS type FROM counterparty_master_individual
      UNION ALL
      SELECT id, short_name AS name, 'joint' AS type FROM counterparty_master_joint
      ORDER BY name
    `;
    const [rows] = await db.query(sql);
    return rows;
  },
  create: async (data) => {
    const sql = `INSERT INTO counterparty_limits (
      counterparty_id, counterparty_type, overall_exposure_limit, currency_limit,
      product_money_market_limit, product_fx_limit, product_derivative_limit, product_repo_limit,
      product_reverse_repo_limit, product_gsec_limit, product_sell_and_buy_back_limit, product_buy_and_sell_back_limit,
      tenor_limit, settlement_risk_limit, country_limit, group_limit, intraday_limit, product_transaction_limit, currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.counterparty_id,
      data.counterparty_type,
      data.overall_exposure_limit,
      data.currency_limit,
      data.product_money_market_limit,
      data.product_fx_limit,
      data.product_derivative_limit,
      data.product_repo_limit,
      data.product_reverse_repo_limit,
      data.product_gsec_limit,
      data.product_sell_and_buy_back_limit,
      data.product_buy_and_sell_back_limit,
      data.tenor_limit,
      data.settlement_risk_limit,
      data.country_limit,
      data.group_limit,
      data.intraday_limit,
      data.product_transaction_limit,
      data.currency || 'LKR'
    ];
    const [result] = await db.query(sql, values);
    return result;
  },
  
  getLimitsByCounterparty: async (counterpartyId, counterpartyType, currency = 'LKR') => {
    const sql = `
      SELECT * FROM counterparty_limits 
      WHERE counterparty_id = ? 
      AND counterparty_type = ?
      AND (currency = ? OR currency IS NULL OR currency = '')
    `;
    const [rows] = await db.query(sql, [counterpartyId, counterpartyType, currency]);
    return rows[0];
  },

  // Check if a transaction would exceed product-specific or overall limits
  checkTransactionLimit: async (counterpartyId, counterpartyType, productType, amount, currency = 'LKR') => {
    // Get current limit setup for this counterparty
    const limits = await LimitSetup.getLimitsByCounterparty(counterpartyId, counterpartyType, currency);
    
    if (!limits) {
      return { 
        allowed: false, 
        message: 'No limits configured for this counterparty and currency' 
      };
    }
    
    // Get current exposure for this counterparty in this product
    const [productExposureRows] = await db.query(
      `SELECT SUM(amount) AS total FROM transactions 
       WHERE counterparty_id = ? AND transaction_type_id IN 
       (SELECT id FROM transaction_types WHERE product_type = ?) AND currency = ?`,
      [counterpartyId, productType, currency]
    );
    const currentProductExposure = parseFloat(productExposureRows[0]?.total || 0);
    
    // Get overall exposure across all products
    const [overallExposureRows] = await db.query(
      `SELECT SUM(amount) AS total FROM transactions 
       WHERE counterparty_id = ? AND currency = ?`,
      [counterpartyId, currency]
    );
    const currentOverallExposure = parseFloat(overallExposureRows[0]?.total || 0);
    
    // Check product-specific limit
    let productLimitField = '';
    switch (productType) {
      case 'transaction':
        productLimitField = 'product_transaction_limit';
        break;
      case 'money_market':
        productLimitField = 'product_money_market_limit';
        break;
      case 'fx':
        productLimitField = 'product_fx_limit';
        break;
      case 'derivative':
        productLimitField = 'product_derivative_limit';
        break;
      case 'repo':
        productLimitField = 'product_repo_limit';
        break;
      case 'reverse_repo':
        productLimitField = 'product_reverse_repo_limit';
        break;
      case 'gsec':
        productLimitField = 'product_gsec_limit';
        break;
      case 'sell_and_buy_back':
        productLimitField = 'product_sell_and_buy_back_limit';
        break;
      case 'buy_and_sell_back':
        productLimitField = 'product_buy_and_sell_back_limit';
        break;
      default:
        return { 
          allowed: false, 
          message: 'Unknown product type' 
        };
    }
    
    const productLimit = parseFloat(limits[productLimitField] || 0);
    const overallLimit = parseFloat(limits.overall_exposure_limit || 0);
    
    // Check if adding the new amount would exceed either limit
    const newProductExposure = currentProductExposure + parseFloat(amount);
    const newOverallExposure = currentOverallExposure + parseFloat(amount);
    
    if (productLimit > 0 && newProductExposure > productLimit) {
      return {
        allowed: false,
        message: `Transaction exceeds ${productType} limit (${newProductExposure} > ${productLimit})`,
        currentExposure: currentProductExposure,
        limit: productLimit,
        exceededAmount: newProductExposure - productLimit
      };
    }
    
    if (overallLimit > 0 && newOverallExposure > overallLimit) {
      return {
        allowed: false,
        message: `Transaction exceeds overall exposure limit (${newOverallExposure} > ${overallLimit})`,
        currentExposure: currentOverallExposure,
        limit: overallLimit,
        exceededAmount: newOverallExposure - overallLimit
      };
    }
    
    return { allowed: true };
  }
};

module.exports = LimitSetup;
