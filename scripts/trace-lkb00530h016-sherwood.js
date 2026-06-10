#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/** READ-ONLY: reconstruct holdings/deductions for LKB00530H016 in Sherwood. */

const db = require('../config/database');

const ISIN = 'LKB00530H016';
const PORTFOLIO = 'Sherwood';

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function main() {
  console.log('=== GSEC rows (all transaction types) ===');
  const [gsec] = await db.query(
    `SELECT id, deal_number, transaction_type, status, value_date, face_value,
            remaining_face_value, buyback_deal_id, created_at
     FROM gsec
     WHERE isin_number = ? AND portfolio = ?
     ORDER BY transaction_type, created_at`,
    [ISIN, PORTFOLIO]
  );
  let buyFace = 0;
  let buyRemaining = 0;
  let sellFace = 0;
  for (const r of gsec) {
    const tt = String(r.transaction_type || '').toLowerCase();
    if (tt === 'buy' && r.status !== 'cancelled') {
      buyFace += n(r.face_value);
      buyRemaining += r.remaining_face_value == null ? n(r.face_value) : n(r.remaining_face_value);
    } else if (tt === 'sell' && r.status !== 'cancelled') {
      sellFace += n(r.face_value);
    }
    console.log(
      `  [${r.transaction_type}] id=${r.id} ${r.deal_number} status=${r.status} ` +
        `face=${n(r.face_value).toLocaleString()} remaining=${r.remaining_face_value == null ? 'NULL' : n(r.remaining_face_value).toLocaleString()} ` +
        `bb_id=${r.buyback_deal_id ?? '-'} vd=${r.value_date ? new Date(r.value_date).toISOString().slice(0, 10) : '-'}`
    );
  }

  console.log('\n=== Buyback deals touching this ISIN/portfolio ===');
  const [bb] = await db.query(
    `SELECT id, deal_number, deal_status, leg1_transaction_type, leg1_isin, leg1_portfolio,
            leg1_face_value, leg1_adjusted_face_value, leg2_transaction_type, leg2_isin,
            leg2_face_value, source_buy_deal_number, sell_deal_allocations, approved_at
     FROM buyback_deals
     WHERE (leg1_isin = ? AND leg1_portfolio = ?) OR (leg2_isin = ? AND leg2_portfolio = ?)
     ORDER BY id`,
    [ISIN, PORTFOLIO, ISIN, PORTFOLIO]
  );
  for (const r of bb) {
    console.log(
      `  bb id=${r.id} ${r.deal_number} status=${r.deal_status} ` +
        `leg1=${r.leg1_transaction_type} ${n(r.leg1_face_value).toLocaleString()} (adj ${r.leg1_adjusted_face_value}) ` +
        `leg2=${r.leg2_transaction_type} ${n(r.leg2_face_value).toLocaleString()} ` +
        `src=${r.source_buy_deal_number ?? '-'} alloc=${r.sell_deal_allocations ? 'yes' : 'null'}`
    );
  }

  console.log('\n=== Repo deals on this ISIN ===');
  const [repo] = await db.query(
    `SELECT id, deal_type, status, value_date, maturity_date, isin, face_value, principal_amount
     FROM repo_deals WHERE isin = ? ORDER BY id`,
    [ISIN]
  ).catch(async () => {
    // Fallback: discover columns if names differ
    const [cols] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repo_deals'`
    );
    console.log('  repo_deals columns:', cols.map((c) => c.COLUMN_NAME).join(', '));
    return [[]];
  });
  repo.forEach((r) => console.log('  ' + JSON.stringify(r)));

  console.log('\n=== Summary ===');
  console.log(`  Total non-cancelled BUY face      : ${buyFace.toLocaleString()}`);
  console.log(`  Total BUY remaining (current)     : ${buyRemaining.toLocaleString()}`);
  console.log(`  Implied consumed (face-remaining) : ${(buyFace - buyRemaining).toLocaleString()}`);
  console.log(`  Total non-cancelled SELL face     : ${sellFace.toLocaleString()}`);

  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
