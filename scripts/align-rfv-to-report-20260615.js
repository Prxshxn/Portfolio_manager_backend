#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Align gsec.remaining_face_value on four drifted deals to the GSEC report basis
 * (as at 2026-06-15) so EOD daily accrual posts the report total 513,368.83.
 *
 *   node scripts/align-rfv-to-report-20260615.js           (preview)
 *   node scripts/align-rfv-to-report-20260615.js --commit  (apply)
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const Gsec = require('../models/gsec');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

const COMMIT = process.argv.includes('--commit');
const AS_AT = '2026-06-15';

// Report effective remaining face (face_value column in report output) as at 2026-06-15
const TARGET_RFV = {
  '20250910/GSEC/0001': 3397316.0,
  '20250908/GSEC/0001': 594599.0,
  '20250922/GSEC/0001': 4395275.0,
  '20260608/GSEC/0007': 16043441.0
};

const DEALS = Object.keys(TARGET_RFV);
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

async function buybackDeductionForDeal(dealNumber, asAt) {
  let total = 0;
  const [direct] = await db.query(
    `SELECT COALESCE(SUM(leg1_face_value),0) AS bb FROM buyback_deals
     WHERE deal_status='Approved' AND TRIM(source_buy_deal_number)=TRIM(?)
       AND leg1_transaction_type='Sell' AND approved_at IS NOT NULL AND DATE(approved_at)<=DATE(?)`,
    [dealNumber, asAt]);
  total += num(direct[0] && direct[0].bb);
  const [allocRows] = await db.query(
    `SELECT sell_deal_allocations FROM buyback_deals
     WHERE deal_status='Approved' AND sell_deal_allocations IS NOT NULL
       AND leg1_transaction_type='Sell' AND approved_at IS NOT NULL AND DATE(approved_at)<=DATE(?)`,
    [asAt]);
  for (const r of allocRows) {
    try {
      const a = typeof r.sell_deal_allocations === 'string' ? JSON.parse(r.sell_deal_allocations) : r.sell_deal_allocations;
      if (!Array.isArray(a)) continue;
      for (const x of a) {
        if (String(x.deal_number || '').trim() === dealNumber) total += num(x.amountToSell);
      }
    } catch (_) { /* ignore */ }
  }
  return total;
}

async function soldAgainstDeal(dealNumber, asAt) {
  const [r] = await db.query(
    `SELECT COALESCE(SUM(face_value),0) AS s FROM gsec
     WHERE transaction_type='Sell' AND TRIM(buy_deal_number)=TRIM(?)
       AND value_date IS NOT NULL AND DATE(value_date)<=DATE(?)`,
    [dealNumber, asAt]);
  return num(r[0] && r[0].s);
}

async function gsecRow(dn) {
  const [r] = await db.query(
    `SELECT g.id, g.deal_number, g.face_value, g.remaining_face_value, g.value_date, g.maturity_date,
            g.coupon_interest, g.isin_number, im.coupon_rate, im.coupon_date_1, im.coupon_date_2
     FROM gsec g LEFT JOIN isin_master im
       ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.deal_number=? AND g.transaction_type='Buy' LIMIT 1`, [dn]);
  return r[0];
}

async function main() {
  console.log(`\n=== Align RFV to report basis (${AS_AT}) === mode=${COMMIT ? 'COMMIT' : 'PREVIEW'}\n`);

  const realLog = console.log;
  console.log = () => {};
  const reportService = require('../services/gsecReportService');
  const rep = await reportService.getGsecReport({ asAtDate: AS_AT });
  console.log = realLog;
  const reportByDeal = new Map();
  let reportTotal = 0;
  (rep.data || []).forEach((r) => {
    const dn = String(r.deal_number).trim();
    reportByDeal.set(dn, num(r.daily_accrual));
    reportTotal += num(r.daily_accrual);
  });

  const backup = { deals: [], ledger: [] };
  for (const dn of DEALS) {
    const g = await gsecRow(dn);
    if (!g) throw new Error('Deal not found: ' + dn);
    backup.deals.push(g);
  }
  [backup.ledger] = await db.query(
    `SELECT * FROM ledger_entries WHERE DATE(entry_date)=DATE(?)
       AND description LIKE 'GSec Daily Accrual%' AND deal_number IN (?)`,
    [AS_AT, DEALS]);

  const backupFile = path.join(process.cwd(), `_backup-rfv-align-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log('Backup: ' + backupFile);

  const changes = [];
  let deltaAccrual = 0;

  for (const dn of DEALS) {
    const g = await gsecRow(dn);
    const targetRfv = TARGET_RFV[dn];
    const sold = await soldAgainstDeal(dn, AS_AT);
    const bb = await buybackDeductionForDeal(dn, AS_AT);
    const reportAcc = reportByDeal.get(dn) ?? null;

    const accBefore = computeGsecPerDayAccrual({
      ...g, remaining_face_value: g.remaining_face_value,
      linked_sold_face_value: sold, linked_buyback_face_value: bb
    }, AS_AT, 2);
    const accAfter = computeGsecPerDayAccrual({
      ...g, remaining_face_value: targetRfv,
      linked_sold_face_value: sold, linked_buyback_face_value: bb
    }, AS_AT, 2);

    const beforeAmt = accBefore.ok ? accBefore.amount : 0;
    const afterAmt = accAfter.ok ? accAfter.amount : 0;
    deltaAccrual += afterAmt - beforeAmt;

    console.log(dn);
    console.log(`  face=${num(g.face_value).toLocaleString()}  stored RFV=${num(g.remaining_face_value).toLocaleString()} -> report RFV=${targetRfv.toLocaleString()}`);
    console.log(`  sold=${sold.toLocaleString()} buyback=${bb.toLocaleString()}`);
    console.log(`  accrual: stored-basis=${beforeAmt.toFixed(8)} report=${reportAcc != null ? reportAcc.toFixed(8) : 'n/a'} after-update=${afterAmt.toFixed(8)}`);

    if (reportAcc != null && Math.abs(afterAmt - reportAcc) > 0.01) {
      console.log('  WARNING: after-update accrual does not match report!');
    }

    changes.push({ dn, id: g.id, targetRfv, afterAmt, E: accAfter.ok ? accAfter.E : null });
  }

  // Full portfolio accrual check using report total
  const [posted] = await db.query(
    `SELECT SUM(debit_amount) AS t FROM ledger_entries
     WHERE DATE(entry_date)=DATE(?) AND description LIKE 'GSec Daily Accrual%' AND debit_amount>0`,
    [AS_AT]);
  const postedBefore = num(posted[0] && posted[0].t);

  console.log(`\nReport total daily accrual:     ${reportTotal.toFixed(8)}`);
  console.log(`Posted ledger accrual (${AS_AT}): ${postedBefore.toFixed(8)}`);
  console.log(`Delta from 4-deal RFV fix:        +${deltaAccrual.toFixed(8)}`);
  console.log(`Expected posted after RFV fix:    ${(postedBefore + deltaAccrual).toFixed(8)}`);

  if (!COMMIT) {
    console.log('\nPreview only. Re-run with --commit to apply RFV + repost 2026-06-15 accrual for these deals.\n');
    process.exit(0);
    return;
  }

  // Apply RFV updates
  for (const c of changes) {
    await db.query(
      'UPDATE gsec SET remaining_face_value = ?, per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?',
      [c.targetRfv.toFixed(4), c.afterAmt, c.E, c.id]);
    try { await Gsec.syncFutureCouponCashflowsForBuyDeal(c.dn); } catch (e) { console.warn('cashflow sync ' + c.dn + ': ' + e.message); }
  }
  console.log('\n[1] remaining_face_value + per_day_accrual updated on 4 deals');

  // Repost 2026-06-15 daily accrual for these deals only
  const [[accDr]] = [await db.query(`SELECT account_id FROM ledger_entries WHERE description LIKE 'GSec Daily Accrual%' AND debit_amount>0 LIMIT 1`)];
  const [[accCr]] = [await db.query(`SELECT account_id FROM ledger_entries WHERE description LIKE 'GSec Daily Accrual%' AND credit_amount>0 LIMIT 1`)];
  const drId = accDr[0].account_id;
  const crId = accCr[0].account_id;

  for (const c of changes) {
    await db.query(
      `DELETE FROM ledger_entries WHERE deal_number=? AND DATE(entry_date)=DATE(?)
         AND description LIKE 'GSec Daily Accrual%'`, [c.dn, AS_AT]);
    if (c.afterAmt > 0) {
      await db.query(
        `INSERT INTO ledger_entries (entry_date,account_id,debit_amount,credit_amount,deal_number,description,currency)
         VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
        [AS_AT, drId, c.afterAmt, c.dn, `GSec Daily Accrual for Deal ${c.dn}`]);
      await db.query(
        `INSERT INTO ledger_entries (entry_date,account_id,debit_amount,credit_amount,deal_number,description,currency)
         VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
        [AS_AT, crId, c.afterAmt, c.dn, `GSec Daily Accrual for Deal ${c.dn}`]);
    }
  }
  console.log('[2] reposted 2026-06-15 daily accrual for 4 deals');

  const [posted2] = await db.query(
    `SELECT SUM(debit_amount) AS t FROM ledger_entries
     WHERE DATE(entry_date)=DATE(?) AND description LIKE 'GSec Daily Accrual%' AND debit_amount>0`,
    [AS_AT]);
  console.log(`\nPosted ledger accrual now: ${num(posted2[0].t).toFixed(8)} (target ${reportTotal.toFixed(8)})`);
  console.log('Done.\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
