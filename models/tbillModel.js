const db = require('../config/db');

const REQUIRED_COLUMNS = {
  deal_number: 'VARCHAR(64) NULL',
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
  user_id: 'INT NULL',
  status: "VARCHAR(32) NULL DEFAULT 'pending'",
  current_approval_level: "VARCHAR(32) NULL DEFAULT 'front_office'",
  comment: 'TEXT NULL',
  authorized_by: 'VARCHAR(128) NULL',
  authorized_at: 'DATETIME NULL'
};

const UPDATE_WHITELIST = [
  'trade_date',
  'value_date',
  'transaction_type',
  'counterparty',
  'isin_number',
  'issue_date',
  'maturity_date',
  'face_value',
  'discount_rate_pct',
  'days_to_maturity',
  'price_per_100',
  'settlement_amount',
  'currency',
  'broker_id',
  'portfolio_id',
  'strategy_id',
  'custodian',
  'settlement_mode',
  'brokerage',
  'clean_price',
  'dirty_price',
  'formula_text',
  'status',
  'current_approval_level'
];

const PAYLOAD_TO_COLUMN = {
  tradeDate: 'trade_date',
  valueDate: 'value_date',
  transactionType: 'transaction_type',
  counterparty: 'counterparty',
  isin: 'isin_number',
  issueDate: 'issue_date',
  maturityDate: 'maturity_date',
  faceValue: 'face_value',
  discountRatePercent: 'discount_rate_pct',
  yield: 'discount_rate_pct',
  daysToMaturity: 'days_to_maturity',
  pricePer100: 'price_per_100',
  settlementAmount: 'settlement_amount',
  currency: 'currency',
  broker: 'broker_id',
  portfolio: 'portfolio_id',
  strategy: 'strategy_id',
  custodian: 'custodian',
  settlementMode: 'settlement_mode',
  brokerage: 'brokerage',
  cleanPrice: 'clean_price',
  dirtyPrice: 'dirty_price',
  priceCalculationFormula: 'formula_text',
  formula_text: 'formula_text',
  status: 'status',
  current_approval_level: 'current_approval_level',
  currentApprovalLevel: 'current_approval_level'
};

async function ensureTbillSchema() {
  const [tables] = await db.query("SHOW TABLES LIKE 'tbill'");
  if (tables.length === 0) {
    await db.query(`
      CREATE TABLE tbill (
        id INT AUTO_INCREMENT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deal_number VARCHAR(64) NULL,
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
        user_id INT NULL,
        status VARCHAR(32) NULL DEFAULT 'pending',
        current_approval_level VARCHAR(32) NULL DEFAULT 'front_office',
        comment TEXT NULL,
        authorized_by VARCHAR(128) NULL,
        authorized_at DATETIME NULL
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

function valueDateToDealDateStr(valueDate) {
  if (!valueDate) return null;
  if (typeof valueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valueDate)) {
    return valueDate.slice(0, 10).replace(/-/g, '');
  }
  const d = new Date(valueDate);
  if (Number.isNaN(d.getTime())) return null;
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

function mapPayloadToColumns(payload) {
  const mapped = {};
  for (const [key, col] of Object.entries(PAYLOAD_TO_COLUMN)) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    let val = payload[key];
    if (col === 'face_value' || col === 'discount_rate_pct' || col === 'price_per_100' ||
        col === 'settlement_amount' || col === 'brokerage' || col === 'clean_price' || col === 'dirty_price') {
      val = parseNum(val);
    } else if (col === 'days_to_maturity' || col === 'broker_id' || col === 'portfolio_id') {
      val = parseIntOrNull(val);
    } else if (col === 'counterparty' || col === 'strategy_id') {
      val = val != null ? String(val) : null;
    } else if (col === 'formula_text') {
      val = val || null;
    }
    mapped[col] = val;
  }
  return mapped;
}

const Tbill = {
  ensureSchema: ensureTbillSchema,

  getLatestDealNumber: async (date) => {
    const [results] = await db.query(
      'SELECT deal_number FROM tbill WHERE deal_number LIKE ? ORDER BY deal_number DESC LIMIT 1',
      [`${date}/TBILL/%`]
    );
    return results[0] ? results[0].deal_number : null;
  },

  generateNextDealNumber: async (date) => {
    try {
      const latest = await Tbill.getLatestDealNumber(date);
      let nextSeq = 1;
      if (latest) {
        const parts = latest.split('/');
        if (parts.length >= 3) {
          const seqNum = parseInt(parts[2], 10);
          if (!Number.isNaN(seqNum)) nextSeq = seqNum + 1;
        }
      }
      return `${date}/TBILL/${String(nextSeq).padStart(4, '0')}`;
    } catch (error) {
      console.error('[TBILL] Failed to generate deal number:', error);
      const timestamp = Date.now().toString().slice(-4);
      return `${date}/TBILL/${timestamp}`;
    }
  },

  create: async (payload) => {
    await ensureTbillSchema();

    let dealNumber = payload.dealNumber || payload.deal_number || null;
    if (!dealNumber && payload.valueDate) {
      const dateStr = valueDateToDealDateStr(payload.valueDate);
      if (dateStr) dealNumber = await Tbill.generateNextDealNumber(dateStr);
    }

    const sql = `
      INSERT INTO tbill (
        deal_number, trade_date, value_date, transaction_type, counterparty, isin_number,
        issue_date, maturity_date, face_value, discount_rate_pct, days_to_maturity,
        price_per_100, settlement_amount, currency, broker_id, portfolio_id, strategy_id,
        custodian, settlement_mode, brokerage, clean_price, dirty_price, formula_text, user_id,
        status, current_approval_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      dealNumber,
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
      parseIntOrNull(payload.userId),
      payload.status || 'pending',
      payload.current_approval_level || payload.currentApprovalLevel || 'front_office'
    ];

    const [result] = await db.query(sql, values);
    return { insertId: result.insertId, dealNumber };
  },

  getRecent: async () => {
    await ensureTbillSchema();
    const sql = `
      SELECT
        t.*,
        t.isin_number AS isin,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', t.counterparty)
        ) AS counterparty_name
      FROM tbill t
      LEFT JOIN counterparty_master_corporate corp
        ON (t.counterparty LIKE 'c%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = corp.id)
        OR (t.counterparty = corp.id)
      LEFT JOIN counterparty_master_individual ind
        ON (t.counterparty LIKE 'i%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = ind.id)
        OR (t.counterparty = ind.id)
      LEFT JOIN counterparty_master_joint joint
        ON (t.counterparty LIKE 'j%' AND CAST(SUBSTRING(t.counterparty, 2) AS UNSIGNED) = joint.id)
        OR (t.counterparty = joint.id)
      ORDER BY t.id DESC
      LIMIT 150
    `;
    const [results] = await db.query(sql);
    return results.map((row) => ({
      ...row,
      dealNumber: row.deal_number,
      tradeDate: row.trade_date,
      valueDate: row.value_date,
      transactionType: row.transaction_type,
      faceValue: row.face_value,
      settlementAmount: row.settlement_amount,
      cleanPrice: row.clean_price,
      dirtyPrice: row.dirty_price,
      pricePer100: row.price_per_100,
      discountRatePercent: row.discount_rate_pct
    }));
  },

  getById: async (id) => {
    await ensureTbillSchema();
    const [rows] = await db.query('SELECT * FROM tbill WHERE id = ?', [id]);
    return rows[0] || null;
  },

  updateStatus: async (id, data) => {
    await ensureTbillSchema();
    const [currentTx] = await db.query(
      'SELECT current_approval_level, status FROM tbill WHERE id = ?',
      [id]
    );
    if (!currentTx || currentTx.length === 0) {
      throw new Error('Transaction not found');
    }

    const currentLevel = currentTx[0].current_approval_level || 'front_office';
    let newStatus = data.status;
    let newApprovalLevel;

    if (data.status === 'approved') {
      if (currentLevel === 'front_office' || currentLevel === 1 || currentLevel === '1') {
        newApprovalLevel = 'back_office_verifier';
        newStatus = 'pending';
      } else if (currentLevel === 'back_office_verifier' || currentLevel === 2 || currentLevel === '2') {
        newApprovalLevel = 'back_office_final';
        newStatus = 'pending';
      } else if (currentLevel === 'back_office_final' || currentLevel === 3 || currentLevel === '3') {
        newApprovalLevel = 'final_approved';
        newStatus = 'final_approved';
      } else {
        newApprovalLevel = currentLevel;
        newStatus = newStatus === 'final_approved' ? 'final_approved' : 'pending';
      }
    } else if (data.status === 'rejected') {
      newStatus = 'rejected';
      newApprovalLevel = 'front_office';
    } else {
      newApprovalLevel = currentLevel;
    }

    const authorizedBy = data.authorized_by || data.authorizedBy || null;
    const hasComment = Object.prototype.hasOwnProperty.call(data, 'comment');

    const sql = hasComment
      ? `UPDATE tbill SET status = ?, current_approval_level = ?, comment = ?, authorized_by = ?, authorized_at = NOW() WHERE id = ?`
      : `UPDATE tbill SET status = ?, current_approval_level = ?, authorized_by = ?, authorized_at = NOW() WHERE id = ?`;

    const values = hasComment
      ? [newStatus, newApprovalLevel, data.comment || null, authorizedBy, id]
      : [newStatus, newApprovalLevel, authorizedBy, id];

    const [result] = await db.query(sql, values);
    return {
      affectedRows: result.affectedRows,
      status: newStatus,
      current_approval_level: newApprovalLevel
    };
  },

  update: async (id, payload) => {
    await ensureTbillSchema();
    const mapped = mapPayloadToColumns(payload);
    const sets = [];
    const values = [];

    for (const col of UPDATE_WHITELIST) {
      if (Object.prototype.hasOwnProperty.call(mapped, col)) {
        sets.push(`${col} = ?`);
        values.push(mapped[col]);
      }
    }

    if (sets.length === 0) {
      throw new Error('No valid fields to update');
    }

    values.push(id);
    const sql = `UPDATE tbill SET ${sets.join(', ')} WHERE id = ?`;
    const [result] = await db.query(sql, values);
    return { affectedRows: result.affectedRows };
  }
};

module.exports = Tbill;
