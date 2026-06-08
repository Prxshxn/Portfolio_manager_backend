/* eslint-disable no-console */
'use strict';

/**
 * DRY-RUN preview of the GSEC maturity (redemption) journal. Writes NOTHING.
 * Uses the same shared service (gsecMaturityLedgerService) that the EOD auto-post
 * and the manual backfill use, so the preview is an exact representation of what
 * would be posted.
 *
 * Usage:
 *   node scripts/preview-gsec-maturity.js                       # default deal
 *   node scripts/preview-gsec-maturity.js 20231124/GSEC/0003    # explicit deal
 */

const db = require('../config/database');
const {
  getBuyRowsForDeal,
  buildGsecMaturityJournal,
  hasMaturityLedger
} = require('../services/gsecMaturityLedgerService');

const DEFAULT_DEAL = '20231124/GSEC/0003';
const DEAL = process.argv[2] || DEFAULT_DEAL;

function r2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function fmt(n) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ymd(d) {
  if (!d) return '(none)';
  return new Date(d).toISOString().slice(0, 10);
}

async function accountName(code) {
  if (!code) return '(unmapped)';
  const [rows] = await db.query(
    'SELECT name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [code]
  );
  return rows && rows[0] ? rows[0].name : '(not in chart_of_accounts)';
}

(async () => {
  console.log('================================================================');
  console.log('  DRY-RUN PREVIEW - GSEC Maturity (Redemption) Journal');
  console.log('  Deal:', DEAL);
  console.log('  NOTHING IS WRITTEN. Review then confirm to backfill.');
  console.log('================================================================\n');

  const rows = await getBuyRowsForDeal(DEAL);
  if (!rows.length) {
    console.log('No Buy record found for deal', DEAL);
    await db.pool.end();
    process.exit(1);
  }

  const head = rows[0];
  const faceTotal = rows.reduce((s, r) => s + Number(r.face_value || 0), 0);
  const journal = await buildGsecMaturityJournal(rows);

  console.log('--- Deal Summary ---');
  console.log('Allocations (Buy rows):', rows.length);
  console.log('ISIN                  :', head.isin_number);
  console.log('Face Value            :', fmt(faceTotal));
  console.log('Remaining Face (redeem):', fmt(journal.redeemFace),
    journal.redeemFace !== faceTotal ? '(partial sells detected)' : '');
  console.log('Clean Price           :', Number(head.clean_price || 0));
  console.log('Value Date            :', ymd(head.value_date));
  console.log('Maturity Date         :', journal.maturityDate);
  console.log('Already matured flag  :', Number(head.matured) ? 'YES' : 'no');
  console.log('Scenario              :', journal.isPremium ? 'PREMIUM (clean > 100)' : 'DISCOUNT (clean <= 100)');
  console.log();
  console.log('Computed redemption components:');
  console.log('  Redemption (par) at maturity :', fmt(journal.redeemFace));
  console.log('  Clean cost (face x clean/100):', fmt(journal.cleanAmt));
  console.log('  Total discount/premium       :', fmt(Math.abs(journal.discount)),
    journal.isPremium ? '(premium - DR)' : '(discount - CR)');
  console.log();

  // ---- Render the exact journal lines the service produced ----
  const lines = [];
  for (const l of journal.drLines) {
    lines.push({ code: l.account_code, name: await accountName(l.account_code), dr: Number(l.amount), cr: 0 });
  }
  for (const l of journal.crLines) {
    lines.push({ code: l.account_code, name: await accountName(l.account_code), dr: 0, cr: Number(l.amount) });
  }

  console.log('--- PROPOSED MATURITY JOURNAL (Preview) ---');
  console.log('Description:', journal.description);
  console.log('Date       :', journal.maturityDate);
  console.log();
  console.log(
    'Account Code'.padEnd(22),
    'Account Name'.padEnd(46),
    'Dr (LKR)'.padStart(16),
    'Cr (LKR)'.padStart(16)
  );
  console.log('-'.repeat(102));
  let drSum = 0;
  let crSum = 0;
  for (const l of lines) {
    console.log(
      String(l.code).padEnd(22),
      String(l.name).slice(0, 46).padEnd(46),
      fmt(l.dr).padStart(16),
      fmt(l.cr).padStart(16)
    );
    drSum += l.dr;
    crSum += l.cr;
  }
  console.log('-'.repeat(102));
  console.log(
    'TOTAL'.padEnd(22),
    ''.padEnd(46),
    fmt(r2(drSum)).padStart(16),
    fmt(r2(crSum)).padStart(16)
  );
  console.log('Net Difference (Dr - Cr):', fmt(r2(drSum - crSum)),
    Math.abs(r2(drSum - crSum)) <= 0.01 ? '=> BALANCED' : '=> NOT BALANCED');
  console.log();

  // ---- Idempotency / already-posted context ----
  const already = await hasMaturityLedger(DEAL);
  console.log('--- Idempotency check ---');
  console.log(already
    ? '  A maturity redemption entry ALREADY EXISTS for this deal -> backfill/EOD will SKIP it.'
    : '  No existing maturity redemption entry -> safe to backfill (EOD would also post it).');
  console.log();

  const [posted] = await db.query(
    `SELECT coa.account_code, coa.name,
            ROUND(SUM(COALESCE(le.debit_amount,0)),2) AS dr,
            ROUND(SUM(COALESCE(le.credit_amount,0)),2) AS cr
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE TRIM(le.deal_number) = ?
     GROUP BY coa.account_code, coa.name
     ORDER BY coa.account_code`,
    [DEAL]
  );
  console.log('--- Already posted to ledger for this deal (all entry types) ---');
  if (!posted.length) {
    console.log('  (none)');
  } else {
    console.log(
      'Account Code'.padEnd(22),
      'Account Name'.padEnd(40),
      'Dr'.padStart(16),
      'Cr'.padStart(16)
    );
    console.log('-'.repeat(96));
    for (const p of posted) {
      console.log(
        String(p.account_code || 'NULL').padEnd(22),
        String(p.name || '').slice(0, 40).padEnd(40),
        fmt(p.dr).padStart(16),
        fmt(p.cr).padStart(16)
      );
    }
    console.log();
    console.log('  NOTE: GSEC daily amortization (EOD) also credits ' + journal.amortCode + ' over the');
    console.log('        bond life. Per your decision the full discount is recognised again at');
    console.log('        maturity (entry posted verbatim as in the screenshot).');
  }
  console.log();

  console.log('================================================================');
  console.log('  END OF PREVIEW - No data has been written.');
  console.log('  To post: node scripts/backfill-gsec-maturity.js "' + DEAL + '"');
  console.log('================================================================');

  await db.pool.end();
  process.exit(0);
})().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
