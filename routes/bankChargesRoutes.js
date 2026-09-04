const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Ensure tables exist (idempotent)
async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bank_charges (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      entry_date    DATE         NOT NULL,
      bank_name     VARCHAR(200) NOT NULL,
      description   VARCHAR(500) NOT NULL,
      amount        DECIMAL(18,2) NOT NULL,
      charge_type   VARCHAR(100) DEFAULT NULL,
      reference_no  VARCHAR(100) DEFAULT NULL,
      account_code  VARCHAR(50)  DEFAULT NULL,
      created_by    VARCHAR(100) DEFAULT NULL,
      created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS internal_transfers (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      transfer_date   DATE         NOT NULL,
      from_account    VARCHAR(200) NOT NULL,
      to_account      VARCHAR(200) NOT NULL,
      amount          DECIMAL(18,2) NOT NULL,
      description     VARCHAR(500) NOT NULL,
      reference_no    VARCHAR(100) DEFAULT NULL,
      transfer_type   VARCHAR(100) DEFAULT NULL,
      created_by      VARCHAR(100) DEFAULT NULL,
      created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ── Bank Charges ──────────────────────────────────────────────

// GET /api/bank-charges?startDate=&endDate=
router.get('/', async (req, res) => {
  try {
    await ensureTables();
    const { startDate, endDate } = req.query;
    let sql = 'SELECT * FROM bank_charges WHERE 1=1';
    const params = [];
    if (startDate) { sql += ' AND entry_date >= ?'; params.push(startDate); }
    if (endDate)   { sql += ' AND entry_date <= ?'; params.push(endDate); }
    sql += ' ORDER BY entry_date DESC, id DESC';
    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bank-charges
router.post('/', async (req, res) => {
  try {
    await ensureTables();
    const { entry_date, bank_name, description, amount, charge_type, reference_no, account_code, created_by } = req.body;
    if (!entry_date || !bank_name || !description || amount == null) {
      return res.status(400).json({ success: false, error: 'entry_date, bank_name, description and amount are required' });
    }
    const [result] = await db.query(
      `INSERT INTO bank_charges (entry_date, bank_name, description, amount, charge_type, reference_no, account_code, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry_date, bank_name, description, Number(amount), charge_type || null, reference_no || null, account_code || null, created_by || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/bank-charges/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM bank_charges WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Internal Transfers ────────────────────────────────────────

// GET /api/bank-charges/transfers?startDate=&endDate=
router.get('/transfers', async (req, res) => {
  try {
    await ensureTables();
    const { startDate, endDate } = req.query;
    let sql = 'SELECT * FROM internal_transfers WHERE 1=1';
    const params = [];
    if (startDate) { sql += ' AND transfer_date >= ?'; params.push(startDate); }
    if (endDate)   { sql += ' AND transfer_date <= ?'; params.push(endDate); }
    sql += ' ORDER BY transfer_date DESC, id DESC';
    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/bank-charges/transfers
router.post('/transfers', async (req, res) => {
  try {
    await ensureTables();
    const { transfer_date, from_account, to_account, amount, description, reference_no, transfer_type, created_by } = req.body;
    if (!transfer_date || !from_account || !to_account || amount == null || !description) {
      return res.status(400).json({ success: false, error: 'transfer_date, from_account, to_account, amount and description are required' });
    }
    const [result] = await db.query(
      `INSERT INTO internal_transfers (transfer_date, from_account, to_account, amount, description, reference_no, transfer_type, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [transfer_date, from_account, to_account, Number(amount), description, reference_no || null, transfer_type || null, created_by || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/bank-charges/transfers/:id
router.delete('/transfers/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM internal_transfers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
