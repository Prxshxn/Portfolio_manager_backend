/**
 * Add leg1_clean_price, leg1_dirty_price, leg1_settlement_amount, leg1_custodian,
 * maturity_date, leg1_portfolio, leg1_currency to buyback_deals for portfolio report. Safe to run multiple times.
 */
const db = require('../config/db');

async function addBuybackLeg1PriceColumns() {
  const columns = [
    { name: 'leg1_clean_price', def: 'DECIMAL(20,4) NULL' },
    { name: 'leg1_dirty_price', def: 'DECIMAL(20,4) NULL' },
    { name: 'leg1_settlement_amount', def: 'DECIMAL(20,4) NULL' },
    { name: 'leg1_custodian', def: 'VARCHAR(100) NULL' },
    { name: 'maturity_date', def: 'DATE NULL' },
    { name: 'leg1_portfolio', def: 'VARCHAR(50) NULL' },
    { name: 'leg1_currency', def: 'VARCHAR(3) NULL' }
  ];

  try {
    for (const col of columns) {
      const [rows] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buyback_deals' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (rows.length > 0) {
        console.log(`⏭ buyback_deals.${col.name} already exists`);
        continue;
      }
      await db.query(`ALTER TABLE buyback_deals ADD COLUMN ${col.name} ${col.def}`);
      console.log(`✓ buyback_deals.${col.name} added`);
    }
    console.log('Migration add-buyback-leg1-price-settlement-columns completed.');
  } catch (err) {
    console.error('Migration add-buyback-leg1-price-settlement-columns failed:', err.message);
    throw err;
  }
}

if (require.main === module) {
  addBuybackLeg1PriceColumns()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = addBuybackLeg1PriceColumns;
