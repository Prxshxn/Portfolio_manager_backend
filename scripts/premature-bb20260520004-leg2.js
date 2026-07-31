#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Premature BB20260520004 leg2 (Buy/Sell buyback) to 2026-06-15 with user-supplied
 * pricing, then retro-post leg2 sell ledger on buyback GL accounts.
 *
 * Usage: node scripts/premature-bb20260520004-leg2.js [--execute]
 */

const db = require('../config/database');
const { postBuySellBuybackLedger } = require('../services/buybackBuySellLedgerService');

const EXECUTE = process.argv.includes('--execute');
const DEAL = 'BB20260520004';

const INPUT = {
  leg1InterestRate: 11.5,
  dayCountBasis: 365, // user typed 356; system supports 365/364 only
  leg2ValueDate: '2026-06-15',
  leg2TradeDate: '2026-06-15',
  leg2SettlementAmount: 1216150.25,
  leg2CleanPrice: 134.8718,
  leg2DirtyPrice: 143.0762,
  leg2Yield: 11.5,
  leg2AccruedPer100: 8.2044 // 143.0762 - 134.8718
};

function calcDaysBetween(d1Str, d2Str) {
  const d1 = new Date(d1Str);
  const d2 = new Date(d2Str);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  return Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
}

async function main() {
  const [rows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ? LIMIT 1', [DEAL]);
  if (!rows.length) throw new Error(`${DEAL} not found`);
  const deal = rows[0];

  if (deal.deal_status !== 'Approved' || !deal.approved_at) {
    throw new Error(`${DEAL} must be Approved with approved_at set`);
  }
  if (deal.leg1_transaction_type !== 'Buy' || deal.leg2_transaction_type !== 'Sell') {
    throw new Error(`${DEAL} expected Buy/Sell buyback`);
  }

  const leg1Settlement = parseFloat(deal.leg1_settlement_amount);
  const days = calcDaysBetween(deal.leg1_value_date, INPUT.leg2ValueDate);
  const interest =
    Math.round(
      leg1Settlement * (INPUT.leg1InterestRate / 100) * (days / INPUT.dayCountBasis) * 100
    ) / 100;

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log('Deal:', DEAL, 'id=', deal.id);
  console.log('Leg1 VD:', String(deal.leg1_value_date).slice(0, 10));
  console.log('New leg2 VD:', INPUT.leg2ValueDate, '| days:', days);
  console.log('Leg1 settlement:', leg1Settlement, '| interest @', INPUT.leg1InterestRate + '%:', interest);
  console.log('User leg2 settlement:', INPUT.leg2SettlementAmount);
  console.log('User leg2 clean/dirty/yield:', INPUT.leg2CleanPrice, INPUT.leg2DirtyPrice, INPUT.leg2Yield);

  const [leg2Le] = await db.query(
    'SELECT COUNT(*) AS c FROM ledger_entries WHERE deal_number = ?',
    [`${DEAL}/BB-L2/SELL`]
  );
  console.log('Existing leg2 ledger lines:', leg2Le[0].c);

  if (!EXECUTE) {
    console.log('\nDRY-RUN only. Re-run with --execute to update buyback + post leg2 ledger.');
    process.exit(0);
  }

  await db.query(
    `UPDATE buyback_deals
     SET leg1_interest_rate = ?,
         leg1_yield_rate = ?,
         leg2_value_date = ?,
         leg2_trade_date = ?,
         leg2_settlement_amount = ?,
         leg2_clean_price = ?,
         leg2_dirty_price = ?,
         leg2_accrued_interest = ?,
         leg2_yield_rate = ?,
         updated_at = NOW()
     WHERE id = ? AND deal_status = 'Approved'`,
    [
      INPUT.leg1InterestRate,
      INPUT.leg2Yield,
      INPUT.leg2ValueDate,
      INPUT.leg2TradeDate,
      INPUT.leg2SettlementAmount,
      INPUT.leg2CleanPrice,
      INPUT.leg2DirtyPrice,
      INPUT.leg2AccruedPer100,
      INPUT.leg2Yield,
      deal.id
    ]
  );

  const notes =
    `Premature leg2 (manual): leg1_interest_rate=${INPUT.leg1InterestRate}, ` +
    `leg2_value_date=${INPUT.leg2ValueDate}, days=${days}, basis=${INPUT.dayCountBasis}, ` +
    `interest=${interest.toFixed(2)}, leg2_settlement=${INPUT.leg2SettlementAmount}, ` +
    `leg2_clean=${INPUT.leg2CleanPrice}, leg2_dirty=${INPUT.leg2DirtyPrice}, leg2_yield=${INPUT.leg2Yield}`;

  await db.query(
    `INSERT INTO maturity_processing_log
      (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
       processed_date, processed_by, authorization_level, notes)
     VALUES (?, ?, 'premature_maturity', ?, ?, ?, ?, ?, 'system', ?)`,
    [
      deal.id,
      DEAL,
      leg1Settlement,
      interest,
      INPUT.leg2SettlementAmount,
      INPUT.leg2ValueDate,
      1,
      notes
    ]
  );

  // Remove any prior leg2 sell ledger (should be none)
  const [del] = await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [
    `${DEAL}/BB-L2/SELL`
  ]);
  if (del.affectedRows) console.log('Deleted old leg2 ledger lines:', del.affectedRows);

  const [bbRows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ?', [DEAL]);
  const bb = bbRows[0];

  const result = await postBuySellBuybackLedger(bb, {
    systemDate: INPUT.leg2ValueDate
  });
  console.log('\nLedger posting:', JSON.stringify(result, null, 2));

  const [verify] = await db.query(
    `SELECT le.entry_date, coa.account_code, le.debit_amount, le.credit_amount, le.description
     FROM ledger_entries le
     JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE le.deal_number = ?
     ORDER BY le.id`,
    [`${DEAL}/BB-L2/SELL`]
  );
  console.log('\nPosted leg2 ledger lines:');
  verify.forEach((r) =>
    console.log(
      `  ${String(r.entry_date).slice(0, 10)}  ${r.account_code}  DR ${r.debit_amount}  CR ${r.credit_amount}`
    )
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
