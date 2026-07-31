#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Preview GSec Buy deals with coupon dates in Apr/May/Jun 2026
 * where coupon settlement ledger has been posted.
 *
 *   node scripts/preview-coupon-settled-apr-may-jun-2026.js
 */

const db = require('../config/database');

const START = '2026-04-01';
const END = '2026-06-30';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function fmt(n) {
  return num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ymd(d) {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

(async () => {
  const [rows] = await db.query(
    `SELECT g.deal_number, g.isin_number, g.portfolio, g.face_value, g.remaining_face_value,
            g.coupon_interest, g.value_date, g.maturity_date, g.settlement_mode,
            DATE(ics.coupon_date) AS coupon_date,
            MAX(ics.coupon_amount) AS coupon_amount,
            im.coupon_rate
       FROM gsec g
       JOIN isin_coupon_schedule ics
         ON ics.isin COLLATE utf8mb4_unicode_ci = g.isin_number COLLATE utf8mb4_unicode_ci
        AND DATE(ics.coupon_date) BETWEEN DATE(?) AND DATE(?)
       LEFT JOIN isin_master im
         ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
      WHERE g.transaction_type = 'Buy'
        AND g.status = 'final_approved'
        AND DATE(g.value_date) <= DATE(ics.coupon_date)
        AND DATE(g.maturity_date) >= DATE(ics.coupon_date)
      GROUP BY g.deal_number, g.isin_number, g.portfolio, g.face_value, g.remaining_face_value,
               g.coupon_interest, g.value_date, g.maturity_date, g.settlement_mode,
               DATE(ics.coupon_date), im.coupon_rate
      ORDER BY coupon_date, g.deal_number`,
    [START, END]
  );

  const settled = [];
  let unsettledCount = 0;

  for (const row of rows) {
    const couponDateStr = ymd(row.coupon_date);
    const desc = `GSec Coupon Settlement ${row.deal_number} ${couponDateStr}`;

    const [ledger] = await db.query(
      `SELECT le.entry_date, coa.account_code, coa.name,
              le.debit_amount, le.credit_amount, le.description
         FROM ledger_entries le
         JOIN chart_of_accounts coa ON le.account_id = coa.id
        WHERE TRIM(le.deal_number) = TRIM(?)
          AND le.description = ?
        ORDER BY coa.account_code, le.id`,
      [row.deal_number, desc]
    );

    if (!ledger.length) {
      unsettledCount++;
      continue;
    }

    let totalDr = 0;
    let totalCr = 0;
    const lines = ledger.map((l) => {
      totalDr += num(l.debit_amount);
      totalCr += num(l.credit_amount);
      return {
        account_code: l.account_code,
        name: l.name,
        debit: num(l.debit_amount),
        credit: num(l.credit_amount)
      };
    });

    const amount = Math.max(totalDr, totalCr) / 2; // 4-line journal, each side = amount*2

    settled.push({
      deal_number: row.deal_number,
      isin: row.isin_number,
      portfolio: row.portfolio,
      coupon_date: couponDateStr,
      coupon_amount_per100: row.coupon_amount,
      coupon_rate: row.coupon_rate,
      face_value: num(row.face_value),
      remaining_face_value: num(row.remaining_face_value),
      settlement_amount: amount,
      entry_date: ymd(ledger[0].entry_date),
      lines
    });
  }

  // Group by coupon month
  const byMonth = { April: [], May: [], June: [] };
  for (const d of settled) {
    const m = d.coupon_date.slice(5, 7);
    const bucket = m === '04' ? 'April' : m === '05' ? 'May' : m === '06' ? 'June' : 'Other';
    if (byMonth[bucket]) byMonth[bucket].push(d);
  }

  console.log('==============================================================');
  console.log(`GSec coupon settlements — Apr/May/Jun 2026 (SETTLED ONLY)`);
  console.log(`Range: ${START} to ${END}`);
  console.log('==============================================================');
  console.log(`Candidate buy+coupon pairs: ${rows.length}`);
  console.log(`Settled (ledger posted):      ${settled.length}`);
  console.log(`Unsettled (no ledger):        ${unsettledCount}`);
  console.log(`Total settlement amount:      ${fmt(settled.reduce((s, d) => s + d.settlement_amount, 0))}`);

  for (const [month, deals] of Object.entries(byMonth)) {
    if (!deals.length) continue;
    console.log(`\n### ${month} 2026 (${deals.length} deal(s), total ${fmt(deals.reduce((s, d) => s + d.settlement_amount, 0))})`);
    console.log('deal_number | ISIN | coupon_date | entry_date | settlement | face | RFV');
    for (const d of deals) {
      console.log(
        `${d.deal_number} | ${d.isin} | ${d.coupon_date} | ${d.entry_date} | ${fmt(d.settlement_amount)} | ${fmt(d.face_value)} | ${fmt(d.remaining_face_value)}`
      );
    }
  }

  console.log('\n==============================================================');
  console.log('FULL LEDGER ENTRIES (settled deals only)');
  console.log('==============================================================');

  for (const d of settled) {
    console.log(`\n--- ${d.deal_number}  coupon ${d.coupon_date}  posted ${d.entry_date} ---`);
    console.log(`ISIN ${d.isin}  portfolio ${d.portfolio}  amount ${fmt(d.settlement_amount)}`);
    console.log('Account Code              Name                                          Debit           Credit');
    for (const l of d.lines) {
      console.log(
        `${l.account_code.padEnd(24)} ${(l.name || '').slice(0, 44).padEnd(44)} ` +
          `${l.debit ? fmt(l.debit).padStart(14) : ''.padStart(14)} ` +
          `${l.credit ? fmt(l.credit).padStart(14) : ''.padStart(14)}`
      );
    }
    const dr = d.lines.reduce((s, l) => s + l.debit, 0);
    const cr = d.lines.reduce((s, l) => s + l.credit, 0);
    console.log(`${'TOTAL'.padEnd(69)} ${fmt(dr).padStart(14)} ${fmt(cr).padStart(14)}`);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
