#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * scripts/rewrite-lkb01534i155-eod-2026-04-17.js
 *
 * Purpose
 *   Today we first posted GSec daily accrual (at E=183 — old ISIN override),
 *   then posted 49 "Adjustment (ISIN E=184 fix)" reversal pairs totalling 389.44.
 *   The net on the ledger is 706,149.63 but naive summation of all "GSec..."
 *   descriptions gives 706,928.51, which is misleading for finance.
 *
 *   This script collapses both into a clean, single set of entries:
 *     1. For each of the 49 LKB01534I155 deals, UPDATE the original
 *        "GSec Daily Accrual for Deal <n>" DR+CR entries (dated 2026-04-17)
 *        to the corrected amount (E=184 recomputation).
 *     2. DELETE the matching 49 "GSec Accrual Adjustment (ISIN E=184 fix)"
 *        DR+CR entries (dated 2026-04-17).
 *
 *   End state: ledger shows 706,149.63 directly as the 2026-04-17 GSec
 *   accrual total with no reversal row, matching the senior's expectation
 *   under any summation method.
 *
 * Usage
 *   node scripts/rewrite-lkb01534i155-eod-2026-04-17.js            (dry-run)
 *   node scripts/rewrite-lkb01534i155-eod-2026-04-17.js --execute  (apply)
 *
 * Safety
 *   - Single DB transaction; rollback on any error.
 *   - Only affects entries dated 2026-04-17 whose deal belongs to LKB01534I155.
 *   - Re-run safe: if no adjustment entries remain, script does nothing.
 */

const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');
const accountMapping = require('../services/accountMappingService');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  return process.argv[i + 1];
}
const TARGET_DATE = arg('--date', '2026-04-17');
const TARGET_ISIN = 'LKB01534I155';
const ADJ_LIKE = 'GSec Accrual Adjustment (ISIN E=184 fix)%';
const DAILY_LIKE_TEMPLATE = 'GSec Daily Accrual for Deal ';
const DRY_RUN = !process.argv.includes('--execute');
const TOLERANCE = 0.0001;

function fmt(n, d = 4) {
  return (Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}

async function main() {
  console.log('=== LKB01534I155 EOD Rewrite for', TARGET_DATE, '===');
  console.log('Mode:', DRY_RUN ? 'DRY-RUN (no writes)' : 'EXECUTE');

  const drCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
  const crCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);
  const [drRows] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code=? LIMIT 1', [drCode]);
  const [crRows] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code=? LIMIT 1', [crCode]);
  const drId = drRows[0].id;
  const crId = crRows[0].id;

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
  let sumOld = 0, sumNew = 0;

  for (const d of deals) {
    const [drEntry] = await db.query(
      `SELECT id, debit_amount FROM ledger_entries
       WHERE DATE(entry_date) = DATE(?)
         AND deal_number = ?
         AND account_id = ?
         AND description = ?
       ORDER BY id ASC LIMIT 1`,
      [TARGET_DATE, d.deal_number, drId, `${DAILY_LIKE_TEMPLATE}${d.deal_number}`]
    );
    const [crEntry] = await db.query(
      `SELECT id, credit_amount FROM ledger_entries
       WHERE DATE(entry_date) = DATE(?)
         AND deal_number = ?
         AND account_id = ?
         AND description = ?
       ORDER BY id ASC LIMIT 1`,
      [TARGET_DATE, d.deal_number, crId, `${DAILY_LIKE_TEMPLATE}${d.deal_number}`]
    );

    if (!drEntry.length || !crEntry.length) continue;
    const oldAmt = Number(drEntry[0].debit_amount);
    if (oldAmt === 0) continue;

    const c = computeGsecPerDayAccrual(d, TARGET_DATE, 2);
    const newAmt = c.ok ? Number(c.amount) : 0;
    if (Math.abs(newAmt - oldAmt) < TOLERANCE) continue;

    const [adjRows] = await db.query(
      `SELECT id FROM ledger_entries
       WHERE DATE(entry_date) = DATE(?)
         AND deal_number = ?
         AND description LIKE ?`,
      [TARGET_DATE, d.deal_number, ADJ_LIKE]
    );

    plans.push({
      deal_id: d.id,
      deal_number: d.deal_number,
      dr_entry_id: drEntry[0].id,
      cr_entry_id: crEntry[0].id,
      old: oldAmt,
      new: newAmt,
      newE: c.E,
      adj_ids: adjRows.map((r) => r.id)
    });
    sumOld += oldAmt;
    sumNew += newAmt;
  }

  console.log('\n--- PLAN (first 10 shown, total', plans.length, ') ---');
  console.log('deal                  old        ->  new         adj rows');
  for (const p of plans.slice(0, 10)) {
    console.log(
      p.deal_number.padEnd(22),
      fmt(p.old).padStart(12),
      ' -> ',
      fmt(p.new).padStart(12),
      '   ',
      p.adj_ids.length,
      'adj entries to delete'
    );
  }
  const totalAdjIds = plans.reduce((s, p) => s + p.adj_ids.length, 0);
  console.log('\n--- SUMMARY ---');
  console.log('Deals to rewrite             :', plans.length);
  console.log('Adjustment entries to delete :', totalAdjIds);
  console.log('SUM (original debit amounts) :', fmt(sumOld, 2));
  console.log('SUM (corrected amounts)      :', fmt(sumNew, 2));
  console.log('NET difference               :', fmt(sumNew - sumOld, 2));

  if (DRY_RUN) {
    console.log('\nDRY-RUN complete. Re-run with --execute to apply.');
    process.exit(0);
  }
  if (!plans.length) {
    console.log('\nNothing to do. Exiting.');
    process.exit(0);
  }

  console.log('\n=== EXECUTING ===');
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const p of plans) {
      await conn.query('UPDATE ledger_entries SET debit_amount = ? WHERE id = ?', [p.new, p.dr_entry_id]);
      await conn.query('UPDATE ledger_entries SET credit_amount = ? WHERE id = ?', [p.new, p.cr_entry_id]);
      if (p.adj_ids.length) {
        await conn.query(
          `DELETE FROM ledger_entries WHERE id IN (${p.adj_ids.map(() => '?').join(',')})`,
          p.adj_ids
        );
      }
      await conn.query(
        `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?`,
        [p.new, p.newE, p.deal_id]
      );
    }
    await conn.commit();
    console.log('Committed:', plans.length, 'deals rewritten;', totalAdjIds, 'adjustment entries deleted.');
  } catch (err) {
    await conn.rollback();
    console.error('Transaction rolled back:', err.message);
    process.exit(2);
  } finally {
    conn.release();
  }

  const [verifyDr] = await db.query(
    `SELECT IFNULL(SUM(debit_amount),0) s FROM ledger_entries
     WHERE DATE(entry_date)=DATE(?) AND account_id=?
       AND description LIKE 'GSec Daily Accrual for Deal %'`,
    [TARGET_DATE, drId]
  );
  const [verifyAdjAny] = await db.query(
    `SELECT COUNT(*) c FROM ledger_entries
     WHERE DATE(entry_date)=DATE(?) AND description LIKE ?`,
    [TARGET_DATE, ADJ_LIKE]
  );
  console.log('POST-REWRITE GSec accrual (asset DR) for', TARGET_DATE, ':', fmt(Number(verifyDr[0].s), 2));
  console.log('POST-REWRITE adjustment rows remaining      :', Number(verifyAdjAny[0].c));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
