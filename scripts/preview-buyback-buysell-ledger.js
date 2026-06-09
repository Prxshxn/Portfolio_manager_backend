#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * PREVIEW (no DB writes) of the exact ledger journal lines that the Buy/Sell
 * buyback posting will create for leg1 Buy and leg2 Sell.
 *
 * It intercepts ledgerController's posting methods so the real service computes
 * every line/account/amount exactly as it would when posting, but nothing is
 * written to the database. Value-date deferral is bypassed for preview so you
 * can see ALL legs (deferred legs are flagged separately by the retro dry-run).
 *
 * Usage:
 *   node scripts/preview-buyback-buysell-ledger.js
 *   node scripts/preview-buyback-buysell-ledger.js --from=2026-06-01
 *   node scripts/preview-buyback-buysell-ledger.js --deal=BB20260604001
 */

const db = require('../config/database');
const ledgerController = require('../controllers/ledgerController');

const argv = process.argv.slice(2);
const fromArg = argv.find((a) => a.startsWith('--from='));
const FROM = fromArg ? fromArg.split('=')[1] : '2026-06-01';
const dealArg = argv.find((a) => a.startsWith('--deal='));
const DEAL = dealArg ? dealArg.split('=')[1] : null;

// Captured journal lines keyed by deal_id (synthetic deal number).
const captured = {};
function push(dealId, line) {
  if (!captured[dealId]) captured[dealId] = [];
  captured[dealId].push(line);
}

// --- Intercept the three posting methods so nothing hits the DB ---------------
ledgerController.postCompoundLedgerEntry = async ({ date, dr_accounts, cr_account, deal_id, description }) => {
  const crTotal = (dr_accounts || []).reduce((s, l) => s + Number(l.amount || 0), 0);
  (dr_accounts || []).forEach((l) =>
    push(deal_id, { date, account: l.account_code, dr: Number(l.amount || 0), cr: 0, description: l.description })
  );
  push(deal_id, { date, account: cr_account, dr: 0, cr: crTotal, description });
  return { success: true };
};

ledgerController.postLedgerEntry = async ({ date, dr_account, cr_account, amount, deal_id, description }) => {
  push(deal_id, { date, account: dr_account, dr: Number(amount || 0), cr: 0, description });
  push(deal_id, { date, account: cr_account, dr: 0, cr: Number(amount || 0), description });
  return { success: true };
};

ledgerController.postMultiLineLedgerEntry = async ({ date, dr_accounts, cr_accounts, deal_id, description }) => {
  (dr_accounts || []).forEach((l) =>
    push(deal_id, { date, account: l.account_code, dr: Number(l.amount || 0), cr: 0, description: l.description || description })
  );
  (cr_accounts || []).forEach((l) =>
    push(deal_id, { date, account: l.account_code, dr: 0, cr: Number(l.amount || 0), description: l.description || description })
  );
  return { success: true };
};

// Service is required AFTER patching; it resolves ledgerController lazily per call.
const { postBuySellBuybackLedger } = require('../services/buybackBuySellLedgerService');

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });

function printLeg(title, dealId) {
  const lines = captured[dealId] || [];
  console.log(`\n  ${title}  (ledger deal_number: ${dealId})`);
  if (!lines.length) {
    console.log('    (no lines produced)');
    return;
  }
  console.log('    ' + 'ACCOUNT'.padEnd(24) + 'DR'.padStart(20) + 'CR'.padStart(20) + '  DESCRIPTION');
  let dr = 0;
  let cr = 0;
  lines.forEach((l) => {
    dr += l.dr;
    cr += l.cr;
    console.log(
      '    ' +
        String(l.account).padEnd(24) +
        (l.dr ? fmt(l.dr) : '').padStart(20) +
        (l.cr ? fmt(l.cr) : '').padStart(20) +
        '  ' +
        (l.description || '')
    );
  });
  console.log('    ' + ''.padEnd(24) + fmt(dr).padStart(20) + fmt(cr).padStart(20) + `   [diff ${fmt(dr - cr)}]`);
}

async function main() {
  let sql = `
    SELECT *
    FROM buyback_deals
    WHERE deal_status = 'Approved'
      AND (leg1_transaction_type = 'Buy' OR leg2_transaction_type = 'Sell')
      AND leg1_value_date >= ?
  `;
  const params = [FROM];
  if (DEAL) {
    sql += ' AND deal_number = ?';
    params.push(DEAL);
  }
  sql += ' ORDER BY leg1_value_date ASC, id ASC';

  const [rows] = await db.query(sql, params);
  console.log(
    `PREVIEW (no DB writes) | cutoff leg1_value_date >= ${FROM}` +
      (DEAL ? ` | deal=${DEAL}` : '') +
      ` | candidate buyback(s): ${rows.length}`
  );

  for (const bb of rows) {
    console.log(`\n================ ${bb.deal_number} ================`);
    // Bypass deferral for preview so all legs render.
    await postBuySellBuybackLedger(bb, { dryRun: false, systemDate: '2099-12-31' });

    if (bb.leg1_transaction_type === 'Buy') {
      printLeg(`LEG1 BUY  (face ${fmt(bb.leg1_adjusted_face_value ?? bb.leg1_face_value)}, VD ${String(bb.leg1_value_date).slice(0, 10)})`, `${bb.deal_number}/BB-L1/BUY`);
    }
    if (bb.leg2_transaction_type === 'Sell') {
      printLeg(`LEG2 SELL (face ${fmt(bb.leg2_adjusted_face_value ?? bb.leg2_face_value)}, VD ${String(bb.leg2_value_date).slice(0, 10)})`, `${bb.deal_number}/BB-L2/SELL`);
    }
  }

  console.log('\nNOTE: This is a preview only — nothing was written. Deferral was bypassed here;');
  console.log('under the real system day, legs whose value date is in the future post later automatically.');

  if (typeof db.end === 'function') await db.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
