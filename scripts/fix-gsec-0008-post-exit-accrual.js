/**
 * Correct 20260601/GSEC/0008 after full exit via 20260626/GSEC/0002 (200M sell).
 *
 * - Sets remaining_face_value / per_day_accrual / per_day_amortization to 0
 * - Reverses daily accrual and amortization posted on/after the sell value date
 *   when the position was fully closed (250M sold total).
 *
 * Usage:
 *   node scripts/fix-gsec-0008-post-exit-accrual.js
 *   node scripts/fix-gsec-0008-post-exit-accrual.js --execute
 */
/* eslint-disable no-console */
require('dotenv').config();

const db = require('../config/database');
const ledgerController = require('../controllers/ledgerController');
const accountMapping = require('../services/accountMappingService');
const Gsec = require('../models/gsec');

const BUY_DEAL = '20260601/GSEC/0008';
const SELL_EXIT_VALUE_DATE = '2026-06-26';
const EXECUTE = process.argv.includes('--execute');

const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

async function main() {
  const [buyRows] = await db.query(
    `SELECT id, deal_number, face_value, remaining_face_value, per_day_accrual, per_day_amortization, clean_price
     FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1`,
    [BUY_DEAL]
  );
  const buy = buyRows[0];
  if (!buy) throw new Error(`Buy deal not found: ${BUY_DEAL}`);

  const [soldRows] = await db.query(
    `SELECT deal_number, face_value, value_date, status
     FROM gsec WHERE transaction_type = 'Sell' AND TRIM(buy_deal_number) = TRIM(?)
       AND status <> 'rejected'`,
    [BUY_DEAL]
  );
  const totalSold = soldRows.reduce((s, r) => s + num(r.face_value), 0);
  const targetRfv = Math.max(0, num(buy.face_value) - totalSold);

  const [accrualRows] = await db.query(
    `SELECT DATE(entry_date) AS d, SUM(debit_amount) AS amt
     FROM ledger_entries
     WHERE TRIM(deal_number) = TRIM(?)
       AND description = ?
       AND debit_amount > 0
       AND DATE(entry_date) >= DATE(?)
     GROUP BY DATE(entry_date)
     ORDER BY d`,
    [BUY_DEAL, `GSec Daily Accrual for Deal ${BUY_DEAL}`, SELL_EXIT_VALUE_DATE]
  );

  const [amortRows] = await db.query(
    `SELECT DATE(entry_date) AS d, SUM(debit_amount) AS amt
     FROM ledger_entries
     WHERE TRIM(deal_number) = TRIM(?)
       AND description = ?
       AND debit_amount > 0
       AND DATE(entry_date) >= DATE(?)
     GROUP BY DATE(entry_date)
     ORDER BY d`,
    [BUY_DEAL, `GSec Daily Amortization for Deal ${BUY_DEAL}`, SELL_EXIT_VALUE_DATE]
  );

  const accrualAsset = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
  const accrualIncome = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);
  const amortTrading = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_AMORTISATION_TRADING);
  const amortFa = await accountMapping.getAccountCode(
    accountMapping.MAPPING_KEYS.GSEC_FINANCIAL_ASSETS_AMORTISED_COST
  );

  const accrualTotal = accrualRows.reduce((s, r) => s + num(r.amt), 0);
  const amortTotal = amortRows.reduce((s, r) => s + num(r.amt), 0);

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Buy deal: ${BUY_DEAL}`);
  console.log(`Face: ${num(buy.face_value).toLocaleString()} | Stored RFV: ${num(buy.remaining_face_value).toLocaleString()}`);
  console.log(`Target RFV (all non-rejected sells): ${targetRfv.toLocaleString()}`);
  console.log('Linked sells:', soldRows.map((r) => `${r.deal_number} ${num(r.face_value)} vd=${r.value_date}`).join('; '));
  console.log(`\nAccrual to reverse from ${SELL_EXIT_VALUE_DATE}: ${accrualRows.length} day(s), total ${accrualTotal.toFixed(2)}`);
  for (const r of accrualRows) {
    console.log(`  ${r.d.toISOString().slice(0, 10)}  ${num(r.amt).toFixed(2)}`);
  }
  console.log(`\nAmortization to reverse from ${SELL_EXIT_VALUE_DATE}: ${amortRows.length} day(s), total ${amortTotal.toFixed(2)}`);
  for (const r of amortRows) {
    console.log(`  ${r.d.toISOString().slice(0, 10)}  ${num(r.amt).toFixed(2)}`);
  }

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    return;
  }

  await db.query(
    `UPDATE gsec SET remaining_face_value = ?, per_day_accrual = 0, per_day_amortization = 0, updated_at = NOW()
     WHERE id = ?`,
    [targetRfv.toFixed(4), buy.id]
  );
  try {
    await Gsec.syncFutureCouponCashflowsForBuyDeal(BUY_DEAL);
  } catch (e) {
    console.warn('Cashflow sync warning:', e.message);
  }

  for (const row of accrualRows) {
    const entryDate = row.d.toISOString().slice(0, 10);
    const amount = num(row.amt);
    if (amount <= 0) continue;
    const desc = `GSec Daily Accrual Correction for Deal ${BUY_DEAL} (post-exit reversal ${entryDate})`;
    const [exists] = await db.query(
      `SELECT 1 FROM ledger_entries WHERE TRIM(deal_number) = TRIM(?) AND DATE(entry_date) = DATE(?)
         AND description = ? LIMIT 1`,
      [BUY_DEAL, entryDate, desc]
    );
    if (exists.length) continue;
    const lr = await ledgerController.postLedgerEntry({
      date: entryDate,
      dr_account: accrualIncome,
      cr_account: accrualAsset,
      amount,
      deal_id: BUY_DEAL,
      description: desc
    });
    if (!lr || lr.success !== true) {
      throw new Error(lr?.error || `accrual reversal failed ${entryDate}`);
    }
    console.log(`Reversed accrual ${entryDate}: ${amount.toFixed(2)}`);
  }

  for (const row of amortRows) {
    const entryDate = row.d.toISOString().slice(0, 10);
    const amount = num(row.amt);
    if (amount <= 0) continue;
    const desc = `GSec Daily Amortization Correction for Deal ${BUY_DEAL} (post-exit reversal ${entryDate})`;
    const [exists] = await db.query(
      `SELECT 1 FROM ledger_entries WHERE TRIM(deal_number) = TRIM(?) AND DATE(entry_date) = DATE(?)
         AND description = ? LIMIT 1`,
      [BUY_DEAL, entryDate, desc]
    );
    if (exists.length) continue;
    // EOD posts premium as Dr Trading / Cr FA, and discount as Dr FA / Cr Trading.
    // Reverse by swapping the original direction for this deal's scenario.
    const isPremium = num(buy.clean_price) > 100;
    const drAccount = isPremium ? amortFa : amortTrading;
    const crAccount = isPremium ? amortTrading : amortFa;
    const lr = await ledgerController.postLedgerEntry({
      date: entryDate,
      dr_account: drAccount,
      cr_account: crAccount,
      amount,
      deal_id: BUY_DEAL,
      description: desc
    });
    if (!lr || lr.success !== true) {
      throw new Error(lr?.error || `amort reversal failed ${entryDate}`);
    }
    console.log(`Reversed amortization ${entryDate}: ${amount.toFixed(2)}`);
  }

  const [after] = await db.query(
    `SELECT remaining_face_value, per_day_accrual, per_day_amortization FROM gsec WHERE id = ?`,
    [buy.id]
  );
  console.log('\nDone. Buy row now:', after[0]);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
