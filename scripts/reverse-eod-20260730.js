#!/usr/bin/env node
'use strict';
/**
 * Reverse the mistakenly-run EOD of 2026-07-30 (run before the day's deals
 * were entered).
 *
 * What it does (in one transaction):
 *   1. Backs up + deletes ONLY EOD-generated ledger rows dated 2026-07-30
 *      (daily accruals, amortizations, coupon settlements, repo accrual /
 *      maturity legs, MM daily interest, T-Bill accrual) plus GSec/T-Bill
 *      maturity-redemption rows dated 2026-07-30 or 2026-07-31 (the EOD
 *      matures deals up to the *next* day, dating entries on maturity_date).
 *      Approval/settlement postings for real deals are NOT touched.
 *   2. Un-matures repo/gsec/tbill deals whose maturity entries were deleted.
 *   3. Rolls system_day back to 2026-07-30.
 *
 * Deleted rows are copied to backup table ledger_entries_eod_rev_20260730
 * before deletion so this is restorable.
 *
 * After running: enter the missing deals, then re-run EOD for 2026-07-30.
 *
 * Usage: node scripts/reverse-eod-20260730.js [--execute]
 */
require('dotenv').config();
const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const EOD_DATE = '2026-07-30';
const NEXT_DATE = '2026-07-31';
const BACKUP_TABLE = 'ledger_entries_eod_rev_20260730';

// EOD-generated postings dated on the system day itself.
const SAME_DAY_PATTERNS = [
  'Daily lending interest EOD',
  'Daily borrowing interest EOD',
  'GSec Daily Accrual for Deal %',
  'GSec Daily Amortization for Deal %',
  'GSec Coupon Settlement %',
  'Buy/Sell Buyback Daily Accrual for Deal %',
  'Buy/Sell Buyback Daily Amortization for Deal %',
  'TBill Daily Accrual%',
  'Fixed Deposit Daily Accrual%',
  'Repo Daily Interest Accrual - Deal %',
  'Reverse Repo Daily Interest Accrual - Deal %',
  'Repo Maturity - Deal %',
  'Reverse Repo Maturity - Deal %',
  'Repo Interest Accrual Reversal - Deal %',
  'Reverse Repo Interest Accrual Reversal - Deal %',
  'Repo Borrowing (Backfill) - Deal %',
  'Reverse Repo Purchase (Backfill) - Deal %',
  'Reverse Repo Borrowing (Backfill) - Deal %'
];

// Maturity redemptions are dated on the deal's own maturity_date (30th or 31st).
const MATURITY_PATTERNS = [
  'GSec Maturity - Redemption -%',
  'TBill Maturity - Redemption -%',
  'TBill Maturity - Interest Recognition -%'
];

function buildWhere() {
  const sameDay = SAME_DAY_PATTERNS.map(() => 'description LIKE ?').join(' OR ');
  const maturity = MATURITY_PATTERNS.map(() => 'description LIKE ?').join(' OR ');
  const where = `(
    (DATE(entry_date) = DATE(?) AND (${sameDay}))
    OR (DATE(entry_date) IN (DATE(?), DATE(?)) AND (${maturity}))
  )`;
  const params = [EOD_DATE, ...SAME_DAY_PATTERNS, EOD_DATE, NEXT_DATE, ...MATURITY_PATTERNS];
  return { where, params };
}

(async () => {
  const { where, params } = buildWhere();

  // ---- Preview ----
  const [summary] = await db.query(
    `SELECT LEFT(description, 60) AS description, DATE(entry_date) AS entry_date,
            COUNT(*) AS rows_cnt, SUM(debit_amount) AS dr, SUM(credit_amount) AS cr
     FROM ledger_entries
     WHERE ${where}
     GROUP BY LEFT(description, 60), DATE(entry_date)
     ORDER BY rows_cnt DESC
     LIMIT 30`,
    params
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM ledger_entries WHERE ${where}`,
    params
  );
  console.log(`Ledger rows matched for deletion: ${total}`);
  console.log('Top groups (max 30 shown):');
  console.table(summary);

  // Matured deals whose maturity rows are being removed
  const [maturedRepoDealNos] = await db.query(
    `SELECT DISTINCT TRIM(REPLACE(REPLACE(description, 'Repo Maturity - Deal ', ''), 'Reverse ', '')) AS deal_number
     FROM ledger_entries
     WHERE DATE(entry_date) = DATE(?)
       AND (description LIKE 'Repo Maturity - Deal %' OR description LIKE 'Reverse Repo Maturity - Deal %')`,
    [EOD_DATE]
  );
  const repoNos = maturedRepoDealNos.map((r) => r.deal_number);
  let repoRows = [];
  if (repoNos.length) {
    const ph = repoNos.map(() => '?').join(',');
    [repoRows] = await db.query(
      `SELECT id, deal_number, status, matured, maturity_date FROM repo_deals WHERE deal_number IN (${ph})`,
      repoNos
    );
  }
  console.log('Repo deals to un-mature:');
  console.table(repoRows);

  const [gsecMatured] = await db.query(
    `SELECT DISTINCT TRIM(deal_number) AS deal_number
     FROM ledger_entries
     WHERE DATE(entry_date) IN (DATE(?), DATE(?)) AND description LIKE 'GSec Maturity - Redemption -%'`,
    [EOD_DATE, NEXT_DATE]
  );
  const [tbillMatured] = await db.query(
    `SELECT DISTINCT TRIM(deal_number) AS deal_number
     FROM ledger_entries
     WHERE DATE(entry_date) IN (DATE(?), DATE(?)) AND description LIKE 'TBill Maturity - Redemption -%'`,
    [EOD_DATE, NEXT_DATE]
  );
  console.log('GSEC deals to un-mature:', gsecMatured.map((r) => r.deal_number));
  console.log('T-Bill deals to un-mature:', tbillMatured.map((r) => r.deal_number));

  const [sys] = await db.query('SELECT id, system_date FROM system_day ORDER BY id DESC LIMIT 1');
  console.log('Current system day:', sys[0]);
  console.log(`Will roll system day back to ${EOD_DATE}`);

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  // ---- Execute ----
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Backup then delete EOD ledger rows
    await conn.query(`CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} LIKE ledger_entries`);
    const [backup] = await conn.query(
      `INSERT INTO ${BACKUP_TABLE} SELECT * FROM ledger_entries WHERE ${where}`,
      params
    );
    const [del] = await conn.query(`DELETE FROM ledger_entries WHERE ${where}`, params);
    if (backup.affectedRows !== del.affectedRows) {
      throw new Error(`Backup count ${backup.affectedRows} != delete count ${del.affectedRows}`);
    }
    console.log(`Backed up + deleted ${del.affectedRows} ledger rows (backup: ${BACKUP_TABLE})`);

    // 2. Un-mature deals
    if (repoNos.length) {
      const ph = repoNos.map(() => '?').join(',');
      const [r] = await conn.query(
        `UPDATE repo_deals SET matured = 0, status = 'Pending' WHERE deal_number IN (${ph}) AND matured = 1`,
        repoNos
      );
      console.log(`Repo deals un-matured: ${r.affectedRows}`);
    }
    if (gsecMatured.length) {
      const nos = gsecMatured.map((r) => r.deal_number);
      const ph = nos.map(() => '?').join(',');
      const [r] = await conn.query(
        `UPDATE gsec SET matured = 0 WHERE TRIM(deal_number) IN (${ph}) AND matured = 1`,
        nos
      );
      console.log(`GSEC rows un-matured: ${r.affectedRows}`);
    }
    if (tbillMatured.length) {
      const nos = tbillMatured.map((r) => r.deal_number);
      const ph = nos.map(() => '?').join(',');
      const [r] = await conn.query(
        `UPDATE tbill SET matured = 0 WHERE TRIM(deal_number) IN (${ph}) AND matured = 1`,
        nos
      );
      console.log(`T-Bill rows un-matured: ${r.affectedRows}`);
    }

    // 3. Roll the system day back
    await conn.query(
      'INSERT INTO system_day (system_date, last_updated) VALUES (?, NOW())',
      [EOD_DATE]
    );
    console.log(`System day rolled back to ${EOD_DATE}`);

    await conn.commit();
    console.log('\nDONE. Enter the missing deals for 2026-07-30, then re-run EOD.');
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exit(1);
  } finally {
    conn.release();
  }
  process.exit(0);
})().catch((e) => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
