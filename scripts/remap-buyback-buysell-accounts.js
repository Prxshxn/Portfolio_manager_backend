#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Re-map the Buy/Sell buyback asset accounts to the dedicated buyback ledgers and
 * re-post the affected legs.
 *
 *   OLD  Treasury 131-101-350-098-44 / Accrued 131-101-350-128-44   (standard GSec)
 *   NEW  Treasury 131-101-350-204-44 / Accrued 131-101-350-208-44   (buyback)
 *
 * Why both legs: the buy leg DEBITS these asset accounts and the sell leg CREDITS
 * (reverses) them. If only the buy side moves to the buyback accounts, the asset
 * accounts won't net to zero on the round-trip. So this remaps any already-posted
 * sell leg too.
 *
 * Behaviour:
 *   - DRY-RUN (default): prints OLD (current ledger) vs NEW (proposed) per leg.
 *   - --execute: deletes existing ledger lines for each affected synthetic leg,
 *     then re-posts via the (now buyback-account-aware) posting service.
 *
 * Deferral: a sell leg whose value date is after the system day is NOT posted
 * (it stays for EOD), but if an OLD sell entry exists it is still re-posted so the
 * accounts stay consistent.
 *
 * Usage:
 *   node scripts/remap-buyback-buysell-accounts.js
 *   node scripts/remap-buyback-buysell-accounts.js --execute
 *   node scripts/remap-buyback-buysell-accounts.js --deal=BB20260604001
 */

const db = require('../config/database');
const ledgerController = require('../controllers/ledgerController');
const { getSystemDay } = require('../models/systemDayModel');

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const dealArg = argv.find((a) => a.startsWith('--deal='));
const ONLY_DEAL = dealArg ? dealArg.split('=')[1] : null;

const DEFAULT_DEALS = [
  'BB20260604001',
  'BB20260604002',
  'BB20260604003',
  'BB20260604004'
];

const BUYBACK_TREASURY_ACCOUNT = '131-101-350-204-44';
const BUYBACK_ACCRUED_ACCOUNT = '131-101-350-208-44';

// ---- Capture posting calls so DRY-RUN computes lines without writing ----------
let CAPTURING = false;
const captured = {};
function cap(dealId, line) {
  if (!captured[dealId]) captured[dealId] = [];
  captured[dealId].push(line);
}
const real = {
  compound: ledgerController.postCompoundLedgerEntry,
  single: ledgerController.postLedgerEntry,
  multi: ledgerController.postMultiLineLedgerEntry
};
function installCapture() {
  ledgerController.postCompoundLedgerEntry = async ({ dr_accounts, cr_account, deal_id, date }) => {
    const crTotal = (dr_accounts || []).reduce((s, l) => s + Number(l.amount || 0), 0);
    (dr_accounts || []).forEach((l) => cap(deal_id, { date, account: l.account_code, dr: Number(l.amount || 0), cr: 0 }));
    cap(deal_id, { date, account: cr_account, dr: 0, cr: crTotal });
    return { success: true };
  };
  ledgerController.postLedgerEntry = async ({ dr_account, cr_account, amount, deal_id, date }) => {
    cap(deal_id, { date, account: dr_account, dr: Number(amount || 0), cr: 0 });
    cap(deal_id, { date, account: cr_account, dr: 0, cr: Number(amount || 0) });
    return { success: true };
  };
  ledgerController.postMultiLineLedgerEntry = async ({ dr_accounts, cr_accounts, deal_id, date }) => {
    (dr_accounts || []).forEach((l) => cap(deal_id, { date, account: l.account_code, dr: Number(l.amount || 0), cr: 0 }));
    (cr_accounts || []).forEach((l) => cap(deal_id, { date, account: l.account_code, dr: 0, cr: Number(l.amount || 0) }));
    return { success: true };
  };
}
function restoreCapture() {
  ledgerController.postCompoundLedgerEntry = real.compound;
  ledgerController.postLedgerEntry = real.single;
  ledgerController.postMultiLineLedgerEntry = real.multi;
}

// Require the posting service AFTER capture hooks are in place (it resolves
// ledgerController lazily per call, so either order works, but be safe).
const {
  postFinalApprovedBuyLedger,
  postFinalApprovedSellLedger
} = require('../services/gsecApprovalLedgerService');

const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });

function legFace(adj, base) {
  const v = adj !== null && adj !== undefined ? adj : base;
  return parseFloat(v) || 0;
}

async function buildLeg1BuyDealContext(bb) {
  let isin = {};
  try {
    const [rows] = await db.query(
      'SELECT issue_date, maturity_date, coupon_rate FROM isin_master WHERE isin_number = ? LIMIT 1',
      [bb.leg1_isin]
    );
    if (rows && rows[0]) isin = rows[0];
  } catch (e) {
    console.warn(`ISIN lookup failed for ${bb.leg1_isin}: ${e.message}`);
  }
  const couponRate = parseFloat(bb.coupon_rate ?? isin.coupon_rate ?? 0) || 0;
  return {
    deal_number: `${bb.deal_number}/BB-L1/BUY`,
    value_date: bb.leg1_value_date,
    trade_date: bb.leg1_trade_date || bb.leg1_value_date,
    maturity_date: bb.maturity_date || isin.maturity_date || null,
    issue_date: bb.issue_date || isin.issue_date || null,
    face_value: legFace(bb.leg1_adjusted_face_value, bb.leg1_face_value),
    clean_price: bb.leg1_clean_price,
    dirty_price: bb.leg1_dirty_price,
    yield: bb.leg1_yield_rate,
    accrued_interest_calculation: couponRate ? couponRate / 2 : null,
    last_coupon_date: null,
    next_coupon_date: null,
    per_day_amortization: 0,
    coupon_interest: null,
    remaining_face_value: null,
    isin_number: bb.leg1_isin
  };
}

async function currentLedger(dealNumber) {
  const [rows] = await db.query(
    `SELECT coa.account_code AS account, le.debit_amount AS dr, le.credit_amount AS cr
     FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ? ORDER BY le.id`,
    [dealNumber]
  );
  return rows;
}

function printLines(title, lines) {
  console.log(`    ${title}`);
  if (!lines || !lines.length) {
    console.log('      (none)');
    return;
  }
  let dr = 0;
  let cr = 0;
  lines.forEach((l) => {
    dr += Number(l.dr || 0);
    cr += Number(l.cr || 0);
    console.log(
      '      ' +
        String(l.account).padEnd(24) +
        (Number(l.dr) ? fmt(l.dr) : '').padStart(20) +
        (Number(l.cr) ? fmt(l.cr) : '').padStart(20)
    );
  });
  console.log('      ' + ''.padEnd(24) + fmt(dr).padStart(20) + fmt(cr).padStart(20) + `   [diff ${fmt(dr - cr)}]`);
}

async function proposedBuy(bb) {
  const synthetic = `${bb.deal_number}/BB-L1/BUY`;
  const face = legFace(bb.leg1_adjusted_face_value, bb.leg1_face_value);
  const buyLike = {
    deal_number: synthetic,
    face_value: face,
    settlement_amount: parseFloat(bb.leg1_settlement_amount) || 0,
    accrued_interest: parseFloat(bb.leg1_accrued_interest) || 0,
    clean_price: bb.leg1_clean_price,
    dirty_price: bb.leg1_dirty_price,
    settlement_mode: bb.leg1_settlement_mode,
    value_date: bb.leg1_value_date,
    trade_date: bb.leg1_trade_date || bb.leg1_value_date,
    transaction_type: 'Buy'
  };
  captured[synthetic] = [];
  CAPTURING = true;
  installCapture();
  await postFinalApprovedBuyLedger(buyLike, {
    descriptionPrefix: `Buyback ${bb.deal_number} - `,
    treasuryAccountOverride: BUYBACK_TREASURY_ACCOUNT,
    accruedAccountOverride: BUYBACK_ACCRUED_ACCOUNT
  });
  restoreCapture();
  CAPTURING = false;
  return captured[synthetic];
}

async function proposedSell(bb) {
  const synthetic = `${bb.deal_number}/BB-L2/SELL`;
  const face = legFace(bb.leg2_adjusted_face_value, bb.leg2_face_value);
  const sellLike = {
    deal_number: synthetic,
    buy_deal_number: bb.source_buy_deal_number || null,
    face_value: face,
    settlement_amount: parseFloat(bb.leg2_settlement_amount) || 0,
    accrued_interest: parseFloat(bb.leg2_accrued_interest) || 0,
    clean_price: bb.leg2_clean_price,
    dirty_price: bb.leg2_dirty_price,
    settlement_mode: bb.leg2_settlement_mode,
    value_date: bb.leg2_value_date,
    trade_date: bb.leg2_trade_date || bb.leg2_value_date,
    transaction_type: 'Sell'
  };
  const buyDealOverride = await buildLeg1BuyDealContext(bb);
  captured[synthetic] = [];
  CAPTURING = true;
  installCapture();
  await postFinalApprovedSellLedger(sellLike, {
    descriptionPrefix: `Buyback ${bb.deal_number} - `,
    buyDealOverride,
    treasuryAccountOverride: BUYBACK_TREASURY_ACCOUNT,
    accruedAtPurchaseAccountOverride: BUYBACK_ACCRUED_ACCOUNT
  });
  restoreCapture();
  CAPTURING = false;
  return captured[synthetic];
}

async function main() {
  const deals = ONLY_DEAL ? [ONLY_DEAL] : DEFAULT_DEALS;
  const sysRow = await getSystemDay();
  const systemDay = sysRow && sysRow.system_date;

  console.log(
    `Mode: ${EXECUTE ? 'EXECUTE (delete + re-post)' : 'DRY-RUN (preview only)'} | ` +
      `system day: ${systemDay ? String(systemDay).slice(0, 10) : '(none)'}\n` +
      `Remap: Treasury ${BUYBACK_TREASURY_ACCOUNT}, Accrued ${BUYBACK_ACCRUED_ACCOUNT}`
  );

  for (const dn of deals) {
    const [rows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ? LIMIT 1', [dn]);
    if (!rows.length) {
      console.log(`\n==== ${dn} ====  (not found)`);
      continue;
    }
    const bb = rows[0];
    const buyDn = `${dn}/BB-L1/BUY`;
    const sellDn = `${dn}/BB-L2/SELL`;

    console.log(`\n================ ${dn} ================`);

    // ----- BUY leg -----
    const oldBuy = await currentLedger(buyDn);
    const newBuy = await proposedBuy(bb);
    console.log(`  BUY  [${buyDn}]`);
    printLines('OLD (current ledger):', oldBuy);
    printLines('NEW (proposed):', newBuy);

    // ----- SELL leg (only show if it already exists, since that's what we'd remap now) -----
    const oldSell = await currentLedger(sellDn);
    if (oldSell.length) {
      const newSell = await proposedSell(bb);
      console.log(`  SELL [${sellDn}]`);
      printLines('OLD (current ledger):', oldSell);
      printLines('NEW (proposed):', newSell);
    } else {
      console.log(`  SELL [${sellDn}] : not yet posted (will post at its value date with new accounts)`);
    }

    if (EXECUTE) {
      // Re-post BUY leg with new accounts.
      const [delBuy] = await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [buyDn]);
      const buyLike = {
        deal_number: buyDn,
        face_value: legFace(bb.leg1_adjusted_face_value, bb.leg1_face_value),
        settlement_amount: parseFloat(bb.leg1_settlement_amount) || 0,
        accrued_interest: parseFloat(bb.leg1_accrued_interest) || 0,
        clean_price: bb.leg1_clean_price,
        dirty_price: bb.leg1_dirty_price,
        settlement_mode: bb.leg1_settlement_mode,
        value_date: bb.leg1_value_date,
        trade_date: bb.leg1_trade_date || bb.leg1_value_date,
        transaction_type: 'Buy'
      };
      const rBuy = await postFinalApprovedBuyLedger(buyLike, {
        descriptionPrefix: `Buyback ${dn} - `,
        treasuryAccountOverride: BUYBACK_TREASURY_ACCOUNT,
        accruedAccountOverride: BUYBACK_ACCRUED_ACCOUNT
      });
      console.log(`  -> BUY deleted ${delBuy.affectedRows} old line(s), re-post ${rBuy.success ? 'OK' : 'FAILED: ' + rBuy.error}`);

      // Re-post SELL leg only if it was already posted.
      if (oldSell.length) {
        const [delSell] = await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [sellDn]);
        const sellLike = {
          deal_number: sellDn,
          buy_deal_number: bb.source_buy_deal_number || null,
          face_value: legFace(bb.leg2_adjusted_face_value, bb.leg2_face_value),
          settlement_amount: parseFloat(bb.leg2_settlement_amount) || 0,
          accrued_interest: parseFloat(bb.leg2_accrued_interest) || 0,
          clean_price: bb.leg2_clean_price,
          dirty_price: bb.leg2_dirty_price,
          settlement_mode: bb.leg2_settlement_mode,
          value_date: bb.leg2_value_date,
          trade_date: bb.leg2_trade_date || bb.leg2_value_date,
          transaction_type: 'Sell'
        };
        const buyDealOverride = await buildLeg1BuyDealContext(bb);
        const rSell = await postFinalApprovedSellLedger(sellLike, {
          descriptionPrefix: `Buyback ${dn} - `,
          buyDealOverride,
          treasuryAccountOverride: BUYBACK_TREASURY_ACCOUNT,
          accruedAtPurchaseAccountOverride: BUYBACK_ACCRUED_ACCOUNT
        });
        console.log(`  -> SELL deleted ${delSell.affectedRows} old line(s), re-post ${rSell.success ? 'OK' : 'FAILED: ' + rSell.error}`);
      }
    }
  }

  if (!EXECUTE) {
    console.log('\nDRY-RUN only — nothing written. Re-run with --execute to delete old lines and re-post with the buyback accounts.');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
