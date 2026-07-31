#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Backfill GSec daily accrual shortfalls from 2026-07-10 onward where multi-lot
 * sells over-counted linked_sold_face_value (SUM sell.face_value by buy_deal_number
 * instead of sell_deal_allocations.amountToSell), suppressing accrual on the
 * primary buy deal.
 *
 * Usage:
 *   node scripts/backfill-gsec-accrual-multilot-sell-20260710.js
 *   node scripts/backfill-gsec-accrual-multilot-sell-20260710.js --start=2026-07-10 --end=2026-07-13
 *   node scripts/backfill-gsec-accrual-multilot-sell-20260710.js --commit
 */
const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');
const {
  buildSoldByDealMap,
  findMultiLotOvercountDeals
} = require('../services/gsecSellDeductionService');

const COMMIT = process.argv.includes('--commit');
const argDate = (flag, fallback) => {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.split('=')[1] : fallback;
};

const DR_ACCOUNT_CODE = '131-101-290-218-44';
const CR_ACCOUNT_CODE = '467-101-190-470-44';

function ymdRange(startYmd, endYmd) {
  const out = [];
  const d = new Date(`${startYmd}T00:00:00.000Z`);
  const end = new Date(`${endYmd}T00:00:00.000Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}

async function resolveAccountId(code) {
  const [rows] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]);
  if (!rows.length) throw new Error(`Account code not found: ${code}`);
  return rows[0].id;
}

async function main() {
  const systemDayRow = await getSystemDay();
  const systemDay = systemDayRow?.system_date
    ? ymd(systemDayRow.system_date)
    : new Date().toISOString().slice(0, 10);

  const START_DATE = argDate('start', '2026-07-10');
  const END_DATE = argDate('end', systemDay);
  const dates = ymdRange(START_DATE, END_DATE);

  console.log(`Backfill window: ${dates.join(', ')}`);
  console.log(COMMIT ? 'MODE: COMMIT (will write to ledger_entries)' : 'MODE: DRY RUN (no writes)');

  const affectedDeals = await findMultiLotOvercountDeals(db);
  console.log(`Deals affected by multi-lot sell over-count: ${affectedDeals.size}`);
  console.log([...affectedDeals].join(', ') || '(none)');

  if (!affectedDeals.size) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  const dealList = [...affectedDeals];
  const placeholders = dealList.map(() => '?').join(',');
  const [gsecDeals] = await db.query(
    `SELECT g.id, g.deal_number, g.value_date, g.maturity_date, g.face_value, g.remaining_face_value,
            g.coupon_interest, g.isin_number, g.status, g.matured,
            im.coupon_rate, im.coupon_date_1, im.coupon_date_2
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.transaction_type = 'Buy'
       AND g.deal_number IN (${placeholders})
       AND g.status = 'final_approved'`,
    dealList
  );

  const [bbRows] = await db.query(
    `SELECT TRIM(source_buy_deal_number) AS source_buy_deal_number, leg1_face_value,
            sell_deal_allocations, approved_at
     FROM buyback_deals
     WHERE deal_status = 'Approved' AND approved_at IS NOT NULL AND leg1_transaction_type = 'Sell'`
  );
  const bbEventsByDeal = {};
  for (const r of bbRows) {
    let allocs = r.sell_deal_allocations;
    if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch { allocs = null; } }
    if (Array.isArray(allocs) && allocs.length > 0) {
      for (const a of allocs) {
        const dn = String((a && a.deal_number) || '').trim();
        const amt = Number(a && a.amountToSell) || 0;
        if (dn && amt > 0) {
          (bbEventsByDeal[dn] = bbEventsByDeal[dn] || []).push({ date: r.approved_at, amt });
        }
      }
    } else if (r.source_buy_deal_number) {
      const dn = r.source_buy_deal_number;
      const amt = Number(r.leg1_face_value) || 0;
      if (dn && amt > 0) {
        (bbEventsByDeal[dn] = bbEventsByDeal[dn] || []).push({ date: r.approved_at, amt });
      }
    }
  }

  const [existingLedger] = await db.query(
    `SELECT deal_number, entry_date, debit_amount, description
     FROM ledger_entries
     WHERE entry_date BETWEEN ? AND ?
       AND debit_amount > 0
       AND (
         description LIKE 'GSec Daily Accrual for Deal %'
         OR description LIKE 'GSec Daily Accrual Backfill for Deal %'
       )`,
    [START_DATE, END_DATE]
  );
  const postedMap = new Map();
  for (const r of existingLedger) {
    const day = ymd(r.entry_date);
    const key = `${r.deal_number}|${day}`;
    postedMap.set(key, (postedMap.get(key) || 0) + Number(r.debit_amount));
  }

  const drAccountId = await resolveAccountId(DR_ACCOUNT_CODE);
  const crAccountId = await resolveAccountId(CR_ACCOUNT_CODE);

  const toBackfill = [];
  let totalShortfall = 0;

  for (const deal of gsecDeals) {
    const dn = deal.deal_number;
    const faceVal = Number(deal.face_value) || 0;
    const bbEvents = (bbEventsByDeal[dn] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const day of dates) {
      if (ymd(deal.value_date) > day) continue;
      if (ymd(deal.maturity_date) <= day) continue;

      const soldByDeal = await buildSoldByDealMap(db, [dn], day);
      const soldAsOfDay = Number(soldByDeal[dn] || 0);
      const buybackAsOfDay = bbEvents.reduce((s, e) => (ymd(e.date) <= day ? s + e.amt : s), 0);
      const correctRemaining = Math.max(0, faceVal - soldAsOfDay - buybackAsOfDay);

      const correctCalc = computeGsecPerDayAccrual(
        Object.assign({}, deal, {
          remaining_face_value: correctRemaining,
          linked_sold_face_value: soldAsOfDay,
          linked_buyback_face_value: buybackAsOfDay
        }),
        day,
        2
      );
      const correctAmt = correctCalc.ok ? Number(correctCalc.amount) : 0;
      if (correctAmt <= 0) continue;

      const posted = postedMap.get(`${dn}|${day}`) || 0;
      const shortfall = Math.round((correctAmt - posted) * 100) / 100;
      if (shortfall > 0.01) {
        toBackfill.push({
          dn,
          day,
          correctRemaining,
          correctAmt: Number(correctAmt.toFixed(2)),
          posted: Number(posted.toFixed(2)),
          shortfall
        });
        totalShortfall += shortfall;
      }
    }
  }

  toBackfill.sort((a, b) => (a.dn === b.dn ? a.day.localeCompare(b.day) : a.dn.localeCompare(b.dn)));
  console.log(`\nEntries needing backfill: ${toBackfill.length}`);
  console.table(toBackfill);
  console.log(`\nTOTAL SHORTFALL for ${START_DATE}..${END_DATE}: ${totalShortfall.toFixed(2)}`);

  if (!COMMIT) {
    console.log('\nDry run complete. Re-run with --commit to post these backfill entries.');
    if (typeof db.end === 'function') await db.end();
    process.exit(0);
  }

  console.log('\nPosting backfill entries...');
  let postedCount = 0;
  for (const item of toBackfill) {
    const description = `GSec Daily Accrual Backfill for Deal ${item.dn} (${item.day})`;
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
      [item.day, drAccountId, item.shortfall, item.dn, description]
    );
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
      [item.day, crAccountId, item.shortfall, item.dn, description]
    );
    postedCount++;
  }
  console.log(`Posted ${postedCount} backfill entry pairs. Total amount: ${totalShortfall.toFixed(2)}`);
  if (typeof db.end === 'function') await db.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e.message, e.stack);
  process.exit(1);
});
