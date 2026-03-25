const db = require('../config/db');

const REQUIRED_COLUMNS = {
  trade_date: 'DATE NULL',
  value_date: 'DATE NULL',
  transaction_type: 'VARCHAR(16) NULL',
  counterparty: 'VARCHAR(64) NULL',
  isin_number: 'VARCHAR(32) NULL',
  issue_date: 'DATE NULL',
  maturity_date: 'DATE NULL',
  face_value: 'DECIMAL(20,4) NULL',
  discount_rate_pct: 'DECIMAL(12,6) NULL',
  days_to_maturity: 'INT NULL',
  price_per_100: 'DECIMAL(16,6) NULL',
  settlement_amount: 'DECIMAL(20,4) NULL',
  currency: 'VARCHAR(16) NULL',
  broker_id: 'INT NULL',
  portfolio_id: 'INT NULL',
  strategy_id: 'VARCHAR(64) NULL',
  custodian: 'VARCHAR(255) NULL',
  settlement_mode: 'VARCHAR(128) NULL',
  brokerage: 'DECIMAL(16,4) NULL',
  clean_price: 'DECIMAL(16,6) NULL',
  dirty_price: 'DECIMAL(16,6) NULL',
  formula_text: 'TEXT NULL',
  user_id: 'INT NULL'
};

async function ensureTbillSchema() {
  const [tables] = await db.query("SHOW TABLES LIKE 'tbill'");
  if (tables.length === 0) {
    await db.query(`
      CREATE TABLE tbill (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        trade_date DATE NULL,
        value_date DATE NULL,
        transaction_type VARCHAR(16) NULL,
        counterparty VARCHAR(64) NULL,
        isin_number VARCHAR(32) NULL,
        issue_date DATE NULL,
        maturity_date DATE NULL,
        face_value DECIMAL(20,4) NULL,
        discount_rate_pct DECIMAL(12,6) NULL,
        days_to_maturity INT NULL,
        price_per_100 DECIMAL(16,6) NULL,
        settlement_amount DECIMAL(20,4) NULL,
        currency VARCHAR(16) NULL,
        broker_id INT NULL,
        portfolio_id INT NULL,
        strategy_id VARCHAR(64) NULL,
        custodian VARCHAR(255) NULL,
        settlement_mode VARCHAR(128) NULL,
        brokerage DECIMAL(16,4) NULL,
        clean_price DECIMAL(16,6) NULL,
        dirty_price DECIMAL(16,6) NULL,
        formula_text TEXT NULL,
        user_id INT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    return;
  }

  const [cols] = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbill'`
  );
  const have = new Set(cols.map((c) => c.COLUMN_NAME));
  for (const [name, def] of Object.entries(REQUIRED_COLUMNS)) {
    if (!have.has(name)) {
      await db.query(`ALTER TABLE tbill ADD COLUMN ${name} ${def}`);
    }
  }
}

function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const Tbill = {
  ensureSchema: ensureTbillSchema,

  create: async (payload) => {
    await ensureTbillSchema();

    const sql = `
      INSERT INTO tbill (
        trade_date, value_date, transaction_type, counterparty, isin_number,
        issue_date, maturity_date, face_value, discount_rate_pct, days_to_maturity,
        price_per_100, settlement_amount, currency, broker_id, portfolio_id, strategy_id,
        custodian, settlement_mode, brokerage, clean_price, dirty_price, formula_text, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      payload.tradeDate || null,
      payload.valueDate || null,
      payload.transactionType || null,
      payload.counterparty != null ? String(payload.counterparty) : null,
      payload.isin || null,
      payload.issueDate || null,
      payload.maturityDate || null,
      parseNum(payload.faceValue),
      parseNum(payload.discountRatePercent ?? payload.yield),
      payload.daysToMaturity != null ? parseInt(payload.daysToMaturity, 10) : null,
      parseNum(payload.pricePer100),
      parseNum(payload.settlementAmount),
      payload.currency || 'LKR',
      parseIntOrNull(payload.broker),
      parseIntOrNull(payload.portfolio),
      payload.strategy != null ? String(payload.strategy) : null,
      payload.custodian || null,
      payload.settlementMode || null,
      parseNum(payload.brokerage),
      parseNum(payload.cleanPrice),
      parseNum(payload.dirtyPrice),
      payload.priceCalculationFormula || payload.formula_text || null,
      parseIntOrNull(payload.userId)
    ];

    const [result] = await db.query(sql, values);
    return { insertId: result.insertId };
  }
};

module.exports = Tbill;
