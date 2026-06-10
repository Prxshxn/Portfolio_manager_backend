#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Backfill sell_deal_allocations on buyback deals that were approved without a
 * per-buy-deal linkage (both source_buy_deal_number and sell_deal_allocations
 * were NULL), so the GSEC report deducts the buyback against the correct deals.
 *
 * After writing the allocations, the stored gsec.remaining_face_value for every
 * Buy deal of the affected ISIN/portfolio is recomputed from scratch as:
 *     remaining = face_value
 *               - SUM(ordinary sells linked by buy_deal_number)
 *               - SUM(buyback allocations across all approved buybacks)
 * and future coupon cashflows are re-synced. This keeps the stored column, the
 * report, and accrual/cashflows mutually consistent.
 *
 * Dry-run by default. Pass --execute to apply.
 *
 *   node scripts/backfill-buyback-sell-allocations.js
 *   node scripts/backfill-buyback-sell-allocations.js --execute
 */

const db = require('../config/database');
const Gsec = require('../models/gsec');

const EXECUTE = process.argv.slice(2).includes('--execute');

const ISIN = 'LKB00530H016';
const PORTFOLIO = 'Sherwood';

// User-specified allocations (deal_number -> amountToSell), per buyback.
const ALLOCATIONS = {
  BB20260610002: [
    { deal_number: '20260601/GSEC/0011', amountToSell: 68764369 },
    { deal_number: '20260601/GSEC/0002', amountToSell: 34476660 }
  ],
  BB20260610001: [
    { deal_number: '20260601/GSEC/0003', amountToSell: 50000000 },
    { deal_number: '20260601/GSEC/0002', amountToSell: 15523340 },
    { deal_number: '20260601/GSEC/0004', amountToSell: 14147229 }
  ]
};

function round4(n) {
  return Math.trunc(Number(n) * 10000) / 10000;
}

async function main() {
  console.log(`Buyback sell-allocation backfill  execute=${EXECUTE}  isin=${ISIN} portfolio=${PORTFOLIO}\n`);

  // 1) Validate each buyback exists, is approved, leg1=Sell, and allocations sum to leg1 face.
  const dealNumbers = Object.keys(ALLOCATIONS);
  const [bbRows] = await db.query(
    `SELECT id, deal_number, deal_status, leg1_transaction_type, leg1_isin, leg1_portfolio,
            leg1_face_value, leg1_adjusted_face_value, source_buy_deal_number, sell_deal_allocations
     FROM buyback_deals WHERE deal_number IN (${dealNumbers.map(() => '?').join(',')})`,
    dealNumbers
  );
  const bbByNumber = new Map(bbRows.map((r) => [r.deal_number, r]));

  let validationFailed = false;
  for (const dn of dealNumbers) {
    const bb = bbByNumber.get(dn);
    if (!bb) {
      console.error(`  ! ${dn}: NOT FOUND in buyback_deals`);
      validationFailed = true;
      continue;
    }
    const allocSum = ALLOCATIONS[dn].reduce((s, a) => s + Number(a.amountToSell || 0), 0);
    const leg1Face = Number(
      bb.leg1_adjusted_face_value != null ? bb.leg1_adjusted_face_value : bb.leg1_face_value
    ) || 0;
    const okSum = Math.abs(allocSum - leg1Face) < 0.01;
    console.log(
      `  ${dn}: status=${bb.deal_status} leg1=${bb.leg1_transaction_type} leg1Face=${leg1Face.toLocaleString()} ` +
        `allocSum=${allocSum.toLocaleString()} ${okSum ? 'OK' : 'MISMATCH!'}`
    );
    if (bb.sell_deal_allocations) {
      console.log(`     note: sell_deal_allocations already set -> ${JSON.stringify(bb.sell_deal_allocations)}`);
    }
    if (!okSum) validationFailed = true;
    if (bb.leg1_transaction_type !== 'Sell') {
      console.error(`     ! leg1_transaction_type is not 'Sell'`);
      validationFailed = true;
    }
    if (bb.deal_status !== 'Approved') {
      console.error(`     ! deal_status is not 'Approved'`);
      validationFailed = true;
    }
  }

  if (validationFailed) {
    console.error('\nValidation failed. No changes made.');
    if (typeof db.end === 'function') await db.end();
    process.exit(1);
  }

  // 2) Build buyback deduction map per buy deal (from the allocations we are about to write).
  const buybackByDeal = {};
  for (const dn of dealNumbers) {
    for (const a of ALLOCATIONS[dn]) {
      buybackByDeal[a.deal_number] = (buybackByDeal[a.deal_number] || 0) + Number(a.amountToSell || 0);
    }
  }

  // 3) Ordinary sells (linked by buy_deal_number) per buy deal for this ISIN/portfolio.
  const [sellRows] = await db.query(
    `SELECT TRIM(buy_deal_number) AS buy_deal_number, COALESCE(SUM(face_value), 0) AS sold
     FROM gsec
     WHERE transaction_type = 'Sell' AND isin_number = ? AND portfolio = ? AND buy_deal_number IS NOT NULL
     GROUP BY TRIM(buy_deal_number)`,
    [ISIN, PORTFOLIO]
  );
  const soldByDeal = {};
  sellRows.forEach((r) => {
    soldByDeal[r.buy_deal_number] = Number(r.sold) || 0;
  });

  // 4) Recompute remaining for every Buy deal of this ISIN/portfolio.
  const [buyDeals] = await db.query(
    `SELECT id, deal_number, face_value, remaining_face_value
     FROM gsec
     WHERE transaction_type = 'Buy' AND isin_number = ? AND portfolio = ?
       AND COALESCE(status, '') <> 'cancelled'
     ORDER BY value_date, id`,
    [ISIN, PORTFOLIO]
  );

  console.log('\n  Planned remaining_face_value changes:');
  const updates = [];
  for (const d of buyDeals) {
    const face = Number(d.face_value) || 0;
    const sold = Number(soldByDeal[d.deal_number] || 0);
    const bbDed = Number(buybackByDeal[d.deal_number] || 0);
    const newRemaining = Math.max(0, round4(face - sold - bbDed));
    const current = d.remaining_face_value == null ? null : Number(d.remaining_face_value);
    const changed = current == null || Math.abs(current - newRemaining) > 0.0001;
    console.log(
      `    ${d.deal_number}: face=${face.toLocaleString()} sold=${sold.toLocaleString()} ` +
        `buyback=${bbDed.toLocaleString()} -> remaining ${current == null ? 'NULL' : current.toLocaleString()} => ${newRemaining.toLocaleString()} ${changed ? '(update)' : '(no change)'}`
    );
    if (changed) updates.push({ id: d.id, deal_number: d.deal_number, newRemaining });
  }

  if (!EXECUTE) {
    console.log('\n  Planned sell_deal_allocations writes:');
    for (const dn of dealNumbers) {
      console.log(`    ${dn} <- ${JSON.stringify(ALLOCATIONS[dn])}`);
    }
    console.log('\nDry-run only. Re-run with --execute to apply.');
    if (typeof db.end === 'function') await db.end();
    return;
  }

  // 5) Apply: allocations, remaining_face_value, then coupon cashflow sync.
  for (const dn of dealNumbers) {
    const bb = bbByNumber.get(dn);
    await db.query('UPDATE buyback_deals SET sell_deal_allocations = ? WHERE id = ?', [
      JSON.stringify(ALLOCATIONS[dn]),
      bb.id
    ]);
    console.log(`  wrote sell_deal_allocations for ${dn} (id=${bb.id})`);
  }

  for (const u of updates) {
    await db.query('UPDATE gsec SET remaining_face_value = ? WHERE id = ?', [
      u.newRemaining.toFixed(4),
      u.id
    ]);
    try {
      await Gsec.syncFutureCouponCashflowsForBuyDeal(u.deal_number);
    } catch (e) {
      console.warn(`  (cashflow sync warning for ${u.deal_number}): ${e.message}`);
    }
    console.log(`  updated remaining_face_value for ${u.deal_number} -> ${u.newRemaining.toLocaleString()}`);
  }

  console.log('\nDone.');
  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
