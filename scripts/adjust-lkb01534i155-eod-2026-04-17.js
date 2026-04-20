#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * scripts/adjust-lkb01534i155-eod-2026-04-17.js
 *
 * Purpose
 *   Today's EOD (2026-04-17) posted GSec daily accrual using the old
 *   ISIN_COUPON_SCHEDULE_OVERRIDE for LKB01534I155 (coupon dates 15-Oct / 15-Apr,
 *   E=183 days). Finance policy requires E=184 days (maturity-based rollback,
 *   15-Mar / 15-Sep). The override has now been removed from
 *   services/gsecCouponPeriod.js so going forward EOD will compute E=184 correctly,
 *   but the 2026-04-17 entries were already posted at the wrong amount.
 *
 *   This script:
 *     1. Finds every LKB01534I155 Buy / final_approved deal that had a non-zero
 *        per-day accrual posted in ledger_entries on 2026-04-17.
 *     2. Recomputes the correct amount (now E=184).
 *     3. Posts an adjustment ledger pair per deal for the delta (reversing the
 *        excess that was over-posted). No existing entries are modified.
 *     4. Updates gsec.per_day_accrual and gsec.number_of_days_for_coupon_period
 *        to the corrected values so subsequent EODs don't re-introduce the drift.
 *
 * Usage
 *   node scripts/adjust-lkb01534i155-eod-2026-04-17.js            (dry-run)
 *   node scripts/adjust-lkb01534i155-eod-2026-04-17.js --execute  (apply)
 *
 * Safety
 *   - Single DB transaction for the --execute path; rollback on any error.
 *   - Skips deals that already have a *_ADJUSTMENT entry on 2026-04-17 (idempotent).
 *   - Only touches LKB01534I155 — other ISINs are untouched.
 */

const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');
const accountMapping = require('../services/accountMappingService');

const TARGET_DATE = '2026-04-17';
const TARGET_ISIN = 'LKB01534I155';
const ADJ_TAG = 'GSec Accrual Adjustment (ISIN E=184 fix)';
const TOLERANCE = 0.0001;
const DRY_RUN = !process.argv.includes('--execute');

function fmt(n, d = 4) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}

async function main() {
  console.log('=== LKB01534I155 EOD Adjustment for', TARGET_DATE, '===');
  console.log('Mode:', DRY_RUN ? 'DRY-RUN (no writes)' : 'EXECUTE');

  const drAccountCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
  const crAccountCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);

  const [drAcctRows] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [drAccountCode]);
  const [crAcctRows] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [crAccountCode]);
  if (!drAcctRows.length || !crAcctRows.length) {
    throw new Error('Could not resolve GSEC_ACCRUAL_ASSET / GSEC_ACCRUAL_INCOME account IDs');
  }
  const drAccountId = drAcctRows[0].id;
  const crAccountId = crAcctRows[0].id;
  console.log('GSEC_ACCRUAL_ASSET  account_id:', drAccountId, '(', drAccountCode, ')');
  console.log('GSEC_ACCRUAL_INCOME account_id:', crAccountId, '(', crAccountCode, ')');

  const [deals] = await db.query(
    `SELECT g.id, g.deal_number, g.isin_number, g.face_value, g.remaining_face_value,
            g.coupon_interest, g.value_date, g.maturity_date, g.per_day_accrual,
            g.number_of_days_for_coupon_period,
            im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.isin_number = ?
       AND g.transaction_type = 'Buy'
       AND g.status = 'final_approved'
       AND DATE(g.value_date) <= DATE(?)
       AND DATE(g.maturity_date) >= DATE(?)`,
    [TARGET_ISIN, TARGET_DATE, TARGET_DATE]
  );

  const plans = [];
  let totalOld = 0, totalNew = 0, totalDelta = 0;
  let dealsPostedToday = 0, dealsZeroToday = 0, dealsAlreadyAdjusted = 0;

  for (const d of deals) {
    const [postedRows] = await db.query(
      `SELECT SUM(debit_amount) AS posted FROM ledger_entries
       WHERE DATE(entry_date) = DATE(?)
         AND deal_number = ?
         AND account_id = ?
         AND description LIKE 'GSec Daily Accrual for Deal %'`,
      [TARGET_DATE, d.deal_number, drAccountId]
    );
    const postedOld = Number((postedRows && postedRows[0] && postedRows[0].posted) || 0);

    const [adjRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM ledger_entries
       WHERE DATE(entry_date) = DATE(?)
         AND deal_number = ?
         AND description LIKE '${ADJ_TAG}%'`,
      [TARGET_DATE, d.deal_number]
    );
    const alreadyAdjusted = Number((adjRows && adjRows[0] && adjRows[0].cnt) || 0) > 0;

    const c = computeGsecPerDayAccrual(d, TARGET_DATE, 2);
    const newAmt = c.ok ? Number(c.amount) : 0;
    const delta = newAmt - postedOld;

    if (postedOld === 0) {
      dealsZeroToday++;
    } else {
      dealsPostedToday++;
    }
    if (alreadyAdjusted) dealsAlreadyAdjusted++;

    totalOld += postedOld;
    totalNew += newAmt;
    totalDelta += delta;

    plans.push({
      id: d.id,
      deal_number: d.deal_number,
      postedOld,
      newAmt,
      delta,
      newE: c.E || null,
      alreadyAdjusted,
      skip: alreadyAdjusted || Math.abs(delta) < TOLERANCE
    });
  }

  console.log('\n--- PLAN ---');
  console.log('deal_number           posted(old)      new       delta       E(new)  action');
  for (const p of plans) {
    const action = p.alreadyAdjusted
      ? 'SKIP (already adjusted)'
      : Math.abs(p.delta) < TOLERANCE
      ? 'SKIP (no change)'
      : p.delta < 0
      ? 'REVERSE delta'
      : 'ADD delta';
    console.log(
      p.deal_number.padEnd(22),
      fmt(p.postedOld).padStart(12),
      fmt(p.newAmt).padStart(12),
      fmt(p.delta).padStart(10),
      String(p.newE || '-').padStart(4),
      '  ',
      action
    );
  }

  const toApply = plans.filter((p) => !p.skip);
  console.log('\n--- SUMMARY ---');
  console.log('Total eligible deals              :', deals.length);
  console.log('Deals with posting on target date :', dealsPostedToday);
  console.log('Deals with 0 posting (skipped)    :', dealsZeroToday);
  console.log('Deals already adjusted (skipped)  :', dealsAlreadyAdjusted);
  console.log('Deals to adjust                   :', toApply.length);
  console.log('SUM posted (old)                  :', fmt(totalOld, 2));
  console.log('SUM correct (new)                 :', fmt(totalNew, 2));
  console.log('NET DELTA (new - old)             :', fmt(totalDelta, 2));

  if (DRY_RUN) {
    console.log('\nDRY-RUN complete. Re-run with --execute to apply.');
    process.exit(0);
  }
  if (!toApply.length) {
    console.log('\nNothing to apply. Exiting.');
    process.exit(0);
  }

  console.log('\n=== EXECUTING ===');
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of toApply) {
      const absAmt = Math.abs(p.delta);
      let drId, crId;
      if (p.delta < 0) {
        drId = crAccountId;
        crId = drAccountId;
      } else {
        drId = drAccountId;
        crId = crAccountId;
      }
      const desc = `${ADJ_TAG} for Deal ${p.deal_number}`;
      await conn.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [TARGET_DATE, drId, absAmt, p.deal_number, desc, 'LKR']
      );
      await conn.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
        [TARGET_DATE, crId, absAmt, p.deal_number, desc, 'LKR']
      );
      await conn.query(
        `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?`,
        [p.newAmt, p.newE, p.id]
      );
    }
    await conn.commit();
    console.log('Committed', toApply.length, 'adjustment pairs.');
  } catch (err) {
    await conn.rollback();
    console.error('Transaction rolled back:', err.message);
    process.exit(2);
  } finally {
    conn.release();
  }

  const [verifyRows] = await db.query(
    `SELECT SUM(debit_amount) AS total FROM ledger_entries
     WHERE DATE(entry_date) = DATE(?)
       AND account_id = ?
       AND (description LIKE 'GSec Daily Accrual for Deal %' OR description LIKE '${ADJ_TAG}%')`,
    [TARGET_DATE, drAccountId]
  );
  const [verifyAdjRows] = await db.query(
    `SELECT SUM(debit_amount) AS total FROM ledger_entries
     WHERE DATE(entry_date) = DATE(?)
       AND account_id = ?
       AND description LIKE '${ADJ_TAG}%'`,
    [TARGET_DATE, crAccountId]
  );
  const netTotal =
    Number((verifyRows && verifyRows[0] && verifyRows[0].total) || 0) -
    Number((verifyAdjRows && verifyAdjRows[0] && verifyAdjRows[0].total) || 0);
  console.log('POST-ADJUSTMENT net GSec accrual for', TARGET_DATE, ':', fmt(netTotal, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
