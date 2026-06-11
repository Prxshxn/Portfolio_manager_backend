#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * READ-ONLY diagnostic: explain why a buyback Sell/Buy deal did (not) deduct
 * face value from its source GSEC Buy holdings.
 *
 *   node scripts/diagnose-buyback-deduction.js BB20260610001 BB20260610002
 */

const db = require('../config/database');

const deals = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!deals.length) {
  console.error('Usage: node scripts/diagnose-buyback-deduction.js <deal_number> [<deal_number> ...]');
  process.exit(1);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  for (const dealNumber of deals) {
    console.log('\n==============================================================');
    console.log(`Buyback deal: ${dealNumber}`);
    console.log('==============================================================');

    const [bbRows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ?', [dealNumber]);
    if (!bbRows.length) {
      console.log('  NOT FOUND in buyback_deals');
      continue;
    }
    const bb = bbRows[0];

    console.log('  id                     :', bb.id);
    console.log('  status                 :', bb.status);
    console.log('  leg1_transaction_type  :', bb.leg1_transaction_type);
    console.log('  leg1_isin              :', bb.leg1_isin);
    console.log('  leg1_portfolio         :', bb.leg1_portfolio);
    console.log('  leg1_face_value        :', bb.leg1_face_value);
    console.log('  leg1_adjusted_face     :', bb.leg1_adjusted_face_value);
    console.log('  source_buy_deal_number :', bb.source_buy_deal_number);
    console.log('  sell_deal_allocations  :', bb.sell_deal_allocations);

    const willDeduct = bb.leg1_transaction_type === 'Sell';
    console.log(`  -> deduction branch entered? ${willDeduct ? 'YES (leg1=Sell)' : 'NO (leg1 is not Sell)'}`);

    let allocations = null;
    if (bb.sell_deal_allocations) {
      try {
        allocations = typeof bb.sell_deal_allocations === 'string'
          ? JSON.parse(bb.sell_deal_allocations)
          : bb.sell_deal_allocations;
      } catch (e) {
        console.log('  !! sell_deal_allocations failed to parse:', e.message);
      }
    }

    if (allocations && Array.isArray(allocations) && allocations.length) {
      console.log(`\n  Allocation path (${allocations.length} entry/entries):`);
      for (const alloc of allocations) {
        const dn = alloc.deal_number;
        const amt = num(alloc.amountToSell);
        const [rows] = await db.query(
          `SELECT id, deal_number, face_value, remaining_face_value
           FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1`,
          [dn]
        );
        if (!rows.length) {
          console.log(`    - alloc deal=${dn} amount=${amt}  -> BUY DEAL NOT FOUND (would be skipped)`);
          continue;
        }
        const d = rows[0];
        console.log(
          `    - alloc deal=${dn} amount=${amt}  -> buy id=${d.id} face=${d.face_value} remaining=${d.remaining_face_value}`
        );
      }
    } else {
      console.log('\n  Legacy path (no allocations): would target source_buy_deal_number or FIFO by isin+portfolio.');
    }

    const [buys] = await db.query(
      `SELECT id, deal_number, transaction_type, value_date, face_value, remaining_face_value, status, created_at
       FROM gsec
       WHERE isin_number = ? AND portfolio = ? AND transaction_type = 'Buy'
       ORDER BY created_at ASC`,
      [bb.leg1_isin, bb.leg1_portfolio]
    );
    console.log(`\n  GSEC Buy holdings for isin=${bb.leg1_isin} portfolio=${bb.leg1_portfolio}: ${buys.length}`);
    for (const d of buys) {
      const deducted =
        d.remaining_face_value !== null &&
        d.remaining_face_value !== undefined &&
        num(d.remaining_face_value) < num(d.face_value);
      console.log(
        `    buy id=${d.id} deal=${d.deal_number} status=${d.status} face=${d.face_value} ` +
          `remaining=${d.remaining_face_value} ${deducted ? '(deducted)' : '(NOT deducted)'}`
      );
    }

    const [le] = await db.query(
      `SELECT deal_number, COUNT(*) AS cnt FROM ledger_entries WHERE deal_number LIKE ? GROUP BY deal_number`,
      [`${dealNumber}%`]
    );
    console.log(`\n  Ledger entries referencing ${dealNumber}: ${le.length} group(s)`);
    le.forEach((r) => console.log(`    ${r.deal_number}: ${r.cnt} rows`));
  }

  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
