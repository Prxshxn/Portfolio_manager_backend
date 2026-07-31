#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');
const { buildSoldByDealMap } = require('../services/gsecSellDeductionService');

const DEAL = '20260701/GSEC/0007';
const DAY = '2026-07-10';

(async () => {
  const [ledger] = await db.query(
    `SELECT le.id, le.entry_date, coa.account_code, le.debit_amount, le.credit_amount, le.description
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE le.deal_number = ?
       AND DATE(le.entry_date) = DATE(?)
       AND (
         le.description LIKE 'GSec Daily Accrual for Deal %'
         OR le.description LIKE 'GSec Daily Accrual Backfill for Deal %'
       )
     ORDER BY le.id`,
    [DEAL, DAY]
  );

  const [buyRows] = await db.query(
    `SELECT g.*, im.coupon_rate, im.coupon_date_1, im.coupon_date_2
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.deal_number = ? AND g.transaction_type = 'Buy' LIMIT 1`,
    [DEAL]
  );
  const deal = buyRows[0];
  const sold = await buildSoldByDealMap(db, [DEAL], DAY);
  const soldAsOf = Number(sold[DEAL] || 0);
  const remaining = Math.max(0, Number(deal.face_value) - soldAsOf);
  const calc = computeGsecPerDayAccrual(
    { ...deal, remaining_face_value: remaining, linked_sold_face_value: soldAsOf },
    DAY,
    2
  );

  const totalDr = ledger.filter((r) => Number(r.debit_amount) > 0)
    .reduce((s, r) => s + Number(r.debit_amount), 0);

  console.log('\n=== Corrected report basis (as at 2026-07-10) ===');
  console.log({
    deal: DEAL,
    remaining_face_as_at_day: remaining,
    daily_accrual_should_be: calc.ok ? Number(calc.amount) : null
  });

  console.log('\n=== GL postings on 2026-07-10 ===');
  console.table(ledger.map((r) => ({
    account: r.account_code,
    dr: Number(r.debit_amount) || 0,
    cr: Number(r.credit_amount) || 0,
    description: r.description
  })));
  console.log('Total posted to GL (DR accrual receivable):', totalDr.toFixed(2));

  if (typeof db.end === 'function') await db.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
