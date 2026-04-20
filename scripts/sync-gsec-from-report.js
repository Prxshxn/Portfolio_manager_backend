#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * scripts/sync-gsec-from-report.js
 *
 * Purpose
 *   Align stored gsec rows (remaining_face_value, coupon_interest, per_day_accrual) with the
 *   values shown in the "GSEC Product Report" CSV export. This makes EOD's daily accrual match
 *   what the report (and finance) expects.
 *
 * Usage
 *   node scripts/sync-gsec-from-report.js --csv "<path>" [--only-rfv] [--execute]
 *
 *   --csv <path>   Path to the report CSV. Default: ../gsec_report (59).csv
 *   --only-rfv     Only sync remaining_face_value; leave coupon_interest untouched.
 *   --execute      Apply changes in a single transaction. Without this flag the script is a
 *                  read-only dry-run that prints a before/after diff for every proposed change.
 *
 * Safety
 *   - Only touches rows with status='final_approved' AND transaction_type='Buy'.
 *   - Deals not present in the CSV are left completely alone (genuinely-sold-out deals
 *     with remaining_face_value=0 will NOT be resurrected).
 *   - Runs inside a SQL transaction when --execute is provided; rollback on any error.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

// --- arg parsing ---
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(name);
  if (i === -1) return def;
  return argv[i + 1];
}
const DRY_RUN = !argv.includes('--execute');
const ONLY_RFV = argv.includes('--only-rfv');
const CSV_PATH = path.resolve(arg('--csv', path.join(__dirname, '../../gsec_report (59).csv')));
const TOLERANCE = 0.01;

// --- helpers ---
function parseMoney(s) {
  if (s === null || s === undefined) return 0;
  const t = String(s).replace(/"/g, '').replace(/,/g, '').trim();
  if (!t || t === '-' || t === '00.00') return 0;
  const n = Number(t);
  return Number.isNaN(n) ? 0 : n;
}
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
  return Number(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function approxEq(a, b, tol = TOLERANCE) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tol;
}

async function getSystemDayIso() {
  const [rows] = await db.query('SELECT system_date FROM system_day ORDER BY id DESC LIMIT 1');
  const d = new Date(rows[0].system_date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('CSV not found:', CSV_PATH);
    process.exit(1);
  }
  const sysDay = await getSystemDayIso();

  // 1. Parse CSV
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const reportRows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = parseCsvLine(line);
    const deal = (p[3] || '').trim();
    if (!/^\d{8}\/GSEC\/\d{4}$/.test(deal)) continue;
    reportRows.push({
      deal,
      isin: (p[7] || '').trim(),
      face: parseMoney(p[4]),
      couponInterest: parseMoney(p[10]),
      perDay: parseMoney(p[25]),
    });
  }
  console.log('---- SYNC GSEC FROM REPORT ----');
  console.log('CSV               :', CSV_PATH);
  console.log('Mode              :', DRY_RUN ? 'DRY-RUN (no DB writes)' : 'EXECUTE (transactional)');
  console.log('Scope             :', ONLY_RFV ? 'remaining_face_value only' : 'remaining_face_value + coupon_interest + per_day_accrual');
  console.log('System day        :', sysDay);
  console.log('Report rows parsed:', reportRows.length);

  // 2. Compute diff for every row
  const changes = [];
  const skippedNotFound = [];
  const skippedNoChange = [];

  for (const r of reportRows) {
    const [dbRows] = await db.query(
      `SELECT g.id, g.deal_number, g.isin_number, g.status, g.transaction_type,
              g.face_value, g.remaining_face_value, g.coupon_interest, g.per_day_accrual,
              g.number_of_days_for_coupon_period, g.value_date, g.maturity_date,
              im.coupon_date_1, im.coupon_date_2, im.coupon_rate
       FROM gsec g
       LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
       WHERE g.deal_number = ? AND g.status = 'final_approved' AND g.transaction_type = 'Buy'`,
      [r.deal]
    );
    if (!dbRows.length) { skippedNotFound.push(r); continue; }
    const d = dbRows[0];

    const newRfv = r.face;
    const newCoupon = ONLY_RFV ? Number(d.coupon_interest) : r.couponInterest;

    // Recompute per-day accrual with the NEW values, using the same formula as EOD.
    const sim = { ...d, remaining_face_value: newRfv, coupon_interest: newCoupon };
    const c = computeGsecPerDayAccrual(sim, sysDay, 2);
    const newPerDay = c.ok ? Number(c.amount || 0) : 0;
    const newE = c.ok ? c.E : null;

    const rfvChanged    = !approxEq(d.remaining_face_value, newRfv);
    const couponChanged = !ONLY_RFV && !approxEq(d.coupon_interest, newCoupon);
    const perDayChanged = !approxEq(d.per_day_accrual, newPerDay);
    if (!rfvChanged && !couponChanged && !perDayChanged) { skippedNoChange.push(r.deal); continue; }

    changes.push({
      id: d.id,
      deal: d.deal_number,
      isin: d.isin_number,
      before: {
        remaining_face_value: Number(d.remaining_face_value || 0),
        coupon_interest: Number(d.coupon_interest || 0),
        per_day_accrual: Number(d.per_day_accrual || 0),
      },
      after: {
        remaining_face_value: newRfv,
        coupon_interest: newCoupon,
        per_day_accrual: newPerDay,
        E: newE,
      },
      reportPerDay: r.perDay,
      computedPerDayEqualsReport: approxEq(newPerDay, r.perDay, 0.02),
    });
  }

  // 3. Print the diff report
  console.log('\n====== PROPOSED CHANGES (', changes.length, 'deals ) ======');
  if (!changes.length) {
    console.log('  (nothing to change)');
  } else {
    console.log(
      'Deal                  ISIN           rfv: before  ->  after         coupon: before -> after        per-day: before -> after   (report)  match?'
    );
    for (const c of changes) {
      console.log(
        '  ' + c.deal.padEnd(20) +
        '  ' + c.isin.padEnd(14) +
        '  ' + fmt(c.before.remaining_face_value).padStart(14) +
        ' -> ' + fmt(c.after.remaining_face_value).padStart(14) +
        '   ' + fmt(c.before.coupon_interest).padStart(12) +
        ' -> ' + fmt(c.after.coupon_interest).padStart(12) +
        '   ' + fmt(c.before.per_day_accrual, 4).padStart(10) +
        ' -> ' + fmt(c.after.per_day_accrual, 4).padStart(10) +
        '   (' + fmt(c.reportPerDay, 2).padStart(9) + ')  ' +
        (c.computedPerDayEqualsReport ? 'OK' : 'DIFF')
      );
    }
  }

  // 4. Summary totals
  const sumBefore = changes.reduce((s, c) => s + c.before.per_day_accrual, 0);
  const sumAfter  = changes.reduce((s, c) => s + c.after.per_day_accrual, 0);
  const sumReport = changes.reduce((s, c) => s + c.reportPerDay, 0);

  // Global EOD total AFTER applying these changes (for all eligible deals)
  const [allEligible] = await db.query(
    `SELECT g.id, g.deal_number, g.isin_number, g.face_value, g.remaining_face_value, g.coupon_interest,
            g.value_date, g.maturity_date, im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.transaction_type='Buy' AND g.status='final_approved'
       AND DATE(g.value_date) <= DATE(?) AND DATE(g.maturity_date) >= DATE(?)`,
    [sysDay, sysDay]
  );
  const changesById = new Map(changes.map((c) => [c.id, c]));
  let globalTotal = 0;
  for (const d of allEligible) {
    const override = changesById.get(d.id);
    const deal = override
      ? { ...d, remaining_face_value: override.after.remaining_face_value, coupon_interest: override.after.coupon_interest }
      : d;
    const c = computeGsecPerDayAccrual(deal, sysDay, 2);
    if (c.ok) globalTotal += Number(c.amount || 0);
  }

  console.log('\n====== SUMMARY ======');
  console.log('Rows in CSV                          :', reportRows.length);
  console.log('Deals not found in DB (skipped)      :', skippedNotFound.length);
  console.log('Deals already in sync (skipped)      :', skippedNoChange.length);
  console.log('Deals to change                      :', changes.length);
  console.log('Per-day SUM for changed deals        : before = ', fmt(sumBefore, 4), ' | after = ', fmt(sumAfter, 4), ' | report = ', fmt(sumReport, 2));
  console.log('Projected TOTAL EOD accrual today    :', fmt(globalTotal, 2));
  console.log('Report CSV grand total               :', fmt(reportRows.reduce((s, r) => s + r.perDay, 0), 2));

  if (skippedNotFound.length) {
    console.log('\n-- Deals in CSV but NOT found in DB (final_approved Buy): --');
    skippedNotFound.forEach((r) => console.log('  ', r.deal, r.isin, 'face=', fmt(r.face), 'per-day=', fmt(r.perDay, 2)));
  }

  // 5. Execute if not dry-run
  if (DRY_RUN) {
    console.log('\nDRY-RUN complete. No DB changes were made. Re-run with --execute to apply.');
    process.exit(0);
  }
  if (!changes.length) {
    console.log('\nNothing to change. Exiting.');
    process.exit(0);
  }

  console.log('\n====== EXECUTING ======');
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const c of changes) {
      const params = ONLY_RFV
        ? [c.after.remaining_face_value, c.after.per_day_accrual, c.id]
        : [c.after.remaining_face_value, c.after.coupon_interest, c.after.per_day_accrual, c.id];
      const sql = ONLY_RFV
        ? 'UPDATE gsec SET remaining_face_value = ?, per_day_accrual = ? WHERE id = ?'
        : 'UPDATE gsec SET remaining_face_value = ?, coupon_interest = ?, per_day_accrual = ? WHERE id = ?';
      await conn.query(sql, params);
    }
    await conn.commit();
    console.log('Updated', changes.length, 'gsec rows. Transaction committed.');
  } catch (err) {
    await conn.rollback();
    console.error('Transaction rolled back due to error:', err.message);
    process.exit(2);
  } finally {
    conn.release();
  }

  // 6. Post-update verification
  const [verifyRows] = await db.query(
    `SELECT g.id, g.deal_number, g.isin_number, g.face_value, g.remaining_face_value, g.coupon_interest,
            g.value_date, g.maturity_date, im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.transaction_type='Buy' AND g.status='final_approved'
       AND DATE(g.value_date) <= DATE(?) AND DATE(g.maturity_date) >= DATE(?)`,
    [sysDay, sysDay]
  );
  let verifyTotal = 0;
  for (const d of verifyRows) {
    const c = computeGsecPerDayAccrual(d, sysDay, 2);
    if (c.ok) verifyTotal += Number(c.amount || 0);
  }
  console.log('POST-UPDATE EOD total                :', fmt(verifyTotal, 2));
  console.log('Expected (CSV report total)          :', fmt(reportRows.reduce((s, r) => s + r.perDay, 0), 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
