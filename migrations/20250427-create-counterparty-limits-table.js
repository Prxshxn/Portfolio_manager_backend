const db = require('../config/db');

async function createCounterpartyLimitsTable() {
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS counterparty_limits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        counterparty_id INT NOT NULL,
        counterparty_type VARCHAR(32) NOT NULL,
        overall_exposure_limit DECIMAL(18,2) NULL,
        currency_limit VARCHAR(10) NULL,
        product_money_market_limit DECIMAL(18,2) NULL,
        product_fx_limit DECIMAL(18,2) NULL,
        product_derivative_limit DECIMAL(18,2) NULL,
        product_repo_limit DECIMAL(18,2) NULL,
        product_reverse_repo_limit DECIMAL(18,2) NULL,
        product_gsec_limit DECIMAL(18,2) NULL,
        product_sell_and_buy_back_limit DECIMAL(18,2) NULL,
        product_buy_and_sell_back_limit DECIMAL(18,2) NULL,
        tenor_limit DECIMAL(18,2) NULL,
        settlement_risk_limit DECIMAL(18,2) NULL,
        country_limit DECIMAL(18,2) NULL,
        group_limit DECIMAL(18,2) NULL,
        intraday_limit DECIMAL(18,2) NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await db.query(sql);
    console.log('Counterparty limits table created successfully');
  } catch (error) {
    console.error('Error creating counterparty limits table:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  createCounterpartyLimitsTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createCounterpartyLimitsTable;
