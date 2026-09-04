const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');

const VOUCHER_TYPES = ['payment', 'receipt', 'journal', 'contra'];

// Ensure the voucher_headers table exists (idempotent, same pattern as bankChargesRoutes.js).
// Actual journal postings live in the existing ledger_entries/chart_of_accounts tables;
// this table only carries voucher-specific metadata that has no home there.
async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS voucher_headers (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      voucher_number VARCHAR(50)  NOT NULL UNIQUE,
      voucher_type   VARCHAR(20)  NOT NULL,
      voucher_date   DATE         NOT NULL,
      party          VARCHAR(255) DEFAULT NULL,
      payment_method VARCHAR(50)  DEFAULT NULL,
      description    VARCHAR(500) DEFAULT NULL,
      reference      VARCHAR(255) DEFAULT NULL,
      notes          TEXT         DEFAULT NULL,
      branch_code    VARCHAR(50)  DEFAULT NULL,
      branch_account VARCHAR(50)  DEFAULT NULL,
      branch_name    VARCHAR(100) DEFAULT NULL,
      cheque_number  VARCHAR(50)  DEFAULT NULL,
      amount         DECIMAL(18,2) NOT NULL,
      created_by     VARCHAR(100) DEFAULT NULL,
      created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
      updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_voucher_type (voucher_type),
      INDEX idx_voucher_date (voucher_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

const normalizeLines = (lines) =>
  (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      accountCode: String(l.accountCode || '').trim(),
      amount: parseFloat(l.amount)
    }))
    .filter((l) => l.accountCode && Number.isFinite(l.amount) && l.amount > 0);

// GET /api/vouchers?type=payment|receipt|journal|contra
router.get('/', auth, async (req, res) => {
  try {
    await ensureTables();
    const { type } = req.query;
    let sql = 'SELECT * FROM voucher_headers WHERE 1=1';
    const params = [];
    if (type && type !== 'all') {
      sql += ' AND voucher_type = ?';
      params.push(type);
    }
    sql += ' ORDER BY voucher_date DESC, id DESC';
    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error listing vouchers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vouchers/:voucherNumber
router.get('/:voucherNumber', auth, async (req, res) => {
  try {
    await ensureTables();
    const { voucherNumber } = req.params;
    const [headers] = await db.query('SELECT * FROM voucher_headers WHERE voucher_number = ?', [voucherNumber]);
    if (headers.length === 0) {
      return res.status(404).json({ success: false, error: 'Voucher not found' });
    }
    const [lines] = await db.query(
      `SELECT le.id, le.account_id, coa.account_code, coa.name AS account_name,
              le.debit_amount, le.credit_amount, le.entry_date, le.description
       FROM ledger_entries le
       JOIN chart_of_accounts coa ON coa.id = le.account_id
       WHERE le.deal_number = ?
       ORDER BY le.id ASC`,
      [voucherNumber]
    );
    res.json({ success: true, data: { ...headers[0], lines } });
  } catch (err) {
    console.error('Error fetching voucher detail:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vouchers
router.post('/', auth, async (req, res) => {
  try {
    await ensureTables();
    const {
      voucherNumber, voucherType, voucherDate, party, paymentMethod, description, reference, notes,
      branchCode, branchAccount, branchName, chequeNumber, debitLines, creditLines
    } = req.body;

    if (!voucherNumber || !String(voucherNumber).trim()) {
      return res.status(400).json({ success: false, error: 'voucherNumber is required' });
    }
    if (!VOUCHER_TYPES.includes(voucherType)) {
      return res.status(400).json({ success: false, error: 'voucherType must be one of payment, receipt, journal, contra' });
    }
    if (!voucherDate) {
      return res.status(400).json({ success: false, error: 'voucherDate is required' });
    }

    const dr = normalizeLines(debitLines);
    const cr = normalizeLines(creditLines);
    if (dr.length === 0 || cr.length === 0) {
      return res.status(400).json({ success: false, error: 'Each debit/credit line needs a GL code and a positive amount' });
    }

    const drTotal = dr.reduce((s, l) => s + l.amount, 0);
    const crTotal = cr.reduce((s, l) => s + l.amount, 0);
    if (Math.abs(drTotal - crTotal) > 0.01) {
      return res.status(400).json({
        success: false,
        error: `Debits (${drTotal.toFixed(2)}) must equal credits (${crTotal.toFixed(2)})`
      });
    }

    const allCodes = [...new Set([...dr, ...cr].map((l) => l.accountCode))];
    const [accounts] = await db.query(
      'SELECT id, account_code, name FROM chart_of_accounts WHERE account_code IN (?)',
      [allCodes]
    );
    const accountMap = new Map(accounts.map((a) => [a.account_code, a]));
    const missing = allCodes.filter((c) => !accountMap.has(c));
    if (missing.length > 0) {
      return res.status(400).json({ success: false, error: `Unknown GL account code(s): ${missing.join(', ')}` });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [headerResult] = await conn.query(
        `INSERT INTO voucher_headers
          (voucher_number, voucher_type, voucher_date, party, payment_method, description, reference, notes,
           branch_code, branch_account, branch_name, cheque_number, amount, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          voucherNumber, voucherType, voucherDate, party || null, paymentMethod || null,
          description || null, reference || null, notes || null,
          branchCode || null, branchAccount || null, branchName || null, chequeNumber || null,
          drTotal, req.user?.username || null
        ]
      );

      const glDescription = description || `${voucherType} voucher ${voucherNumber}`;
      const lineRows = [
        ...dr.map((l) => ({ ...l, debit: l.amount, credit: 0 })),
        ...cr.map((l) => ({ ...l, debit: 0, credit: l.amount }))
      ];

      for (const line of lineRows) {
        const account = accountMap.get(line.accountCode);
        await conn.query(
          `INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [voucherNumber, account.id, voucherDate, line.debit, line.credit, 'LKR', glDescription]
        );
      }

      await conn.commit();
      res.status(201).json({ success: true, id: headerResult.insertId, voucherNumber });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: 'Voucher number already exists' });
    }
    console.error('Error creating voucher:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
