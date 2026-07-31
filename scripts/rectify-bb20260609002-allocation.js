#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Rectify wrongly-allocated buyback BB20260609002.
 *
 * The leg1 (Sell, value date 2026-06-09, face 1,198,215) was allocated to
 * 20260604/GSEC/0001 but should have come from 20250908/GSEC/0001.
 *
 * Performs (mirrors production approval + EOD logic):
 *   1. Fix buyback allocation (source_buy_deal_number + sell_deal_allocations).
 *   2. Restore/Set gsec.remaining_face_value: 20260604 -> 1,209,002 ; 20250908 -> 594,599
 *      + resync future coupon cashflows + recompute per_day_accrual/per_day_amortization.
 *   3. Leg1 SELL ledger: delete old slice journal, repost against the correct lot.
 *   4. Daily accrual + amortization from 2026-06-09 forward: delete wrong, repost correct.
 *
 * A JSON backup of every row touched is written before any change.
 * Nothing is written unless run with --commit.
 *
 *   node scripts/rectify-bb20260609002-allocation.js            (dry safety check, no writes)
 *   node scripts/rectify-bb20260609002-allocation.js --commit   (executes)
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const Gsec = require('../models/gsec');
const { postFinalApprovedSellLedger, truncate8 } = require('../services/gsecApprovalLedgerService');
const { computeGsecPerDayAccrual, computeGsecDailyAmortization } = require('../services/gsecCouponPeriod');

const COMMIT = process.argv.includes('--commit');

const BB = 'BB20260609002';
const WRONG = '20260604/GSEC/0001';
const RIGHT = '20250908/GSEC/0001';
const ALLOC_AMOUNT = 1198215;
const WRONG_FINAL_RFV = 1209002.0000;
const RIGHT_FINAL_RFV = 594599.0000;
const FROM_DATE = '2026-06-09'; // leg1 value date
const OLD_SYNTH = `${BB}/BB-L1/${WRONG}`;
const NEW_SYNTH = `${BB}/BB-L1/${RIGHT}`;

const log = (...a) => console.log(...a);
const ymd = (v) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function gsecForCalc(dn) {
  const [r] = await db.query(
    `SELECT g.id, g.deal_number, g.face_value, g.remaining_face_value, g.value_date, g.maturity_date,
            g.clean_price, g.coupon_interest, im.coupon_rate, im.coupon_date_1, im.coupon_date_2, g.isin_number
     FROM gsec g LEFT JOIN isin_master im
       ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.deal_number = ? AND g.transaction_type='Buy' LIMIT 1`, [dn]);
  return r[0];
}

async function main() {
  log(`\n=== Rectify ${BB} ===  mode=${COMMIT ? 'COMMIT (writing)' : 'DRY (no writes)'}\n`);

  // ---- BACKUP ----
  const backup = {};
  [backup.buyback] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ?', [BB]);
  [backup.gsec] = await db.query(
    'SELECT * FROM gsec WHERE deal_number IN (?, ?) AND transaction_type = "Buy"', [WRONG, RIGHT]);
  [backup.leg1_ledger] = await db.query('SELECT * FROM ledger_entries WHERE deal_number = ?', [OLD_SYNTH]);
  [backup.daily_ledger] = await db.query(
    `SELECT * FROM ledger_entries
     WHERE deal_number IN (?, ?) AND DATE(entry_date) >= DATE(?)
       AND (description LIKE 'GSec Daily Accrual%' OR description LIKE 'GSec Daily Amortization%')`,
    [WRONG, RIGHT, FROM_DATE]);

  const backupFile = path.join(process.cwd(), `_backup-${BB}-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  log(`Backup written: ${backupFile}`);
  log(`  buyback rows=${backup.buyback.length} gsec rows=${backup.gsec.length} leg1 ledger=${backup.leg1_ledger.length} daily ledger=${backup.daily_ledger.length}`);

  if (!backup.buyback.length) throw new Error('Buyback not found');

  // Resolve account_ids from existing entries (env-safe).
  const [[accAcc]] = [await db.query(
    `SELECT account_id FROM ledger_entries WHERE description LIKE 'GSec Daily Accrual%' AND debit_amount > 0 LIMIT 1`)];
  const [[accInc]] = [await db.query(
    `SELECT account_id FROM ledger_entries WHERE description LIKE 'GSec Daily Accrual%' AND credit_amount > 0 LIMIT 1`)];
  const [[amoDr]] = [await db.query(
    `SELECT account_id FROM ledger_entries WHERE deal_number = ? AND description LIKE 'GSec Daily Amortization%' AND debit_amount > 0 LIMIT 1`, [WRONG])];
  const [[amoCr]] = [await db.query(
    `SELECT account_id FROM ledger_entries WHERE deal_number = ? AND description LIKE 'GSec Daily Amortization%' AND credit_amount > 0 LIMIT 1`, [WRONG])];
  const accrualDrId = accAcc[0] && accAcc[0].account_id;
  const accrualCrId = accInc[0] && accInc[0].account_id;
  const amortDrId = amoDr[0] && amoDr[0].account_id;
  const amortCrId = amoCr[0] && amoCr[0].account_id;
  if (!accrualDrId || !accrualCrId || !amortDrId || !amortCrId) {
    throw new Error(`Could not resolve account ids (accrualDr=${accrualDrId} accrualCr=${accrualCrId} amortDr=${amortDrId} amortCr=${amortCrId})`);
  }
  log(`Account ids -> accrual DR=${accrualDrId} CR=${accrualCrId} | amort DR=${amortDrId} CR=${amortCrId}`);

  // Date set to correct (from the wrongly-reduced deal's existing daily accruals >= FROM_DATE).
  const [dateRows] = await db.query(
    `SELECT DISTINCT DATE(entry_date) AS d FROM ledger_entries
     WHERE deal_number = ? AND DATE(entry_date) >= DATE(?) AND description LIKE 'GSec Daily Accrual%'
     ORDER BY d`, [WRONG, FROM_DATE]);
  const dates = dateRows.map((r) => ymd(r.d));
  log(`Dates to correct (${dates.length}): ${dates.join(', ')}`);

  if (!COMMIT) {
    log('\nDRY run only. Re-run with --commit to apply.\n');
    if (typeof db.end === 'function') await db.end();
    return;
  }

  // ---- PHASE 1: buyback allocation ----
  const newAllocJson = JSON.stringify([{ deal_number: RIGHT, amountToSell: ALLOC_AMOUNT }]);
  await db.query(
    'UPDATE buyback_deals SET source_buy_deal_number = ?, sell_deal_allocations = ? WHERE deal_number = ?',
    [RIGHT, newAllocJson, BB]);
  log('\n[1] buyback allocation updated -> ' + RIGHT);

  // ---- PHASE 2: holdings ----
  await db.query('UPDATE gsec SET remaining_face_value = ? WHERE deal_number = ? AND transaction_type = "Buy"',
    [WRONG_FINAL_RFV.toFixed(4), WRONG]);
  await db.query('UPDATE gsec SET remaining_face_value = ? WHERE deal_number = ? AND transaction_type = "Buy"',
    [RIGHT_FINAL_RFV.toFixed(4), RIGHT]);
  for (const dn of [WRONG, RIGHT]) {
    try { await Gsec.syncFutureCouponCashflowsForBuyDeal(dn); } catch (e) { log('  cashflow resync warn ' + dn + ': ' + e.message); }
  }
  // recompute per_day fields
  for (const [dn, rfv] of [[WRONG, WRONG_FINAL_RFV], [RIGHT, RIGHT_FINAL_RFV]]) {
    const g = await gsecForCalc(dn);
    const acc = computeGsecPerDayAccrual({ ...g, remaining_face_value: rfv, linked_buyback_face_value: Math.max(0, Number(g.face_value) - rfv) }, FROM_DATE, 2);
    const amo = computeGsecDailyAmortization({ ...g, remaining_face_value: rfv });
    await db.query('UPDATE gsec SET per_day_accrual = ?, per_day_amortization = ? WHERE id = ?',
      [acc.ok ? acc.amount : 0, amo.ok ? amo.dailyAmount : 0, g.id]);
  }
  log('[2] holdings + cashflows + per_day fields updated');

  // ---- PHASE 3: leg1 sell ledger ----
  const [delLeg1] = await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [OLD_SYNTH]);
  const bb = backup.buyback[0];
  const leg1Den = Number(bb.leg1_adjusted_face_value != null ? bb.leg1_adjusted_face_value : bb.leg1_face_value) || 0;
  const ratio = leg1Den > 0 ? ALLOC_AMOUNT / leg1Den : 1;
  const sellLike = {
    deal_number: NEW_SYNTH,
    buy_deal_number: RIGHT,
    face_value: ALLOC_AMOUNT,
    settlement_amount: truncate8(Number(bb.leg1_settlement_amount) * ratio),
    accrued_interest: truncate8(Number(bb.leg1_accrued_interest) * ratio),
    clean_price: bb.leg1_clean_price,
    dirty_price: bb.leg1_dirty_price,
    settlement_mode: bb.leg1_settlement_mode,
    value_date: bb.leg1_value_date,
    trade_date: bb.leg1_trade_date || bb.leg1_value_date,
    transaction_type: 'Sell'
  };
  const sellRes = await postFinalApprovedSellLedger(sellLike, { descriptionPrefix: `Buyback ${BB} - ` });
  log(`[3] leg1 sell ledger: deleted ${delLeg1.affectedRows} old line(s); repost success=${sellRes.success}` + (sellRes.error ? ' err=' + sellRes.error : ''));

  // ---- PHASE 4: daily accrual + amortization ----
  const insertPair = async (date, drId, crId, amount, dealId, description) => {
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, 'LKR')`, [date, drId, amount, dealId, description]);
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, 'LKR')`, [date, crId, amount, dealId, description]);
  };

  for (const [dn, rfv] of [[WRONG, WRONG_FINAL_RFV], [RIGHT, RIGHT_FINAL_RFV]]) {
    const g = await gsecForCalc(dn);
    // delete wrong daily entries from FROM_DATE forward
    const [delA] = await db.query(
      `DELETE FROM ledger_entries WHERE deal_number = ? AND DATE(entry_date) >= DATE(?)
        AND (description LIKE 'GSec Daily Accrual%' OR description LIKE 'GSec Daily Amortization%')`,
      [dn, FROM_DATE]);
    let n = 0;
    for (const date of dates) {
      const acc = computeGsecPerDayAccrual({ ...g, remaining_face_value: rfv, linked_buyback_face_value: Math.max(0, Number(g.face_value) - rfv) }, date, 2);
      const amo = computeGsecDailyAmortization({ ...g, remaining_face_value: rfv });
      if (acc.ok && acc.amount > 0) {
        await insertPair(date, accrualDrId, accrualCrId, acc.amount, dn, `GSec Daily Accrual for Deal ${dn}`);
      }
      if (amo.ok && amo.dailyAmount > 0) {
        // discount scenario for both deals: DR amortFa / CR amortTrading (same as existing entries)
        await insertPair(date, amortDrId, amortCrId, amo.dailyAmount, dn, `GSec Daily Amortization for Deal ${dn}`);
      }
      n++;
    }
    log(`[4] ${dn}: deleted ${delA.affectedRows} old daily line(s); reposted ${n} day(s) at RFV ${rfv.toFixed(2)}`);
  }

  log('\n=== DONE. Verify below. ===');
  // verification
  const [g2] = await db.query('SELECT deal_number, remaining_face_value, per_day_accrual, per_day_amortization FROM gsec WHERE deal_number IN (?,?) AND transaction_type="Buy"', [WRONG, RIGHT]);
  g2.forEach((r) => log(`  ${r.deal_number}: RFV=${r.remaining_face_value} perDayAccrual=${r.per_day_accrual} perDayAmort=${r.per_day_amortization}`));
  const [newLeg1] = await db.query('SELECT COUNT(*) AS c FROM ledger_entries WHERE deal_number = ?', [NEW_SYNTH]);
  log(`  new leg1 ledger lines: ${newLeg1[0].c}`);

  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
