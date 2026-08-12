#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Re-allocate sell 20260812/GSEC/0001 across its source buy lots, repost the
 * sale ledger against the new per-lot cost bases, and resync remaining_face_value.
 *
 * The current allocation totals 104,377,350 against a 100,000,000 face value,
 * so it over-consumes inventory by 4,377,350.
 *
 * Usage:
 *   node scripts/fix-sell-20260812-gsec-0001-allocations.js                        # preview
 *   node scripts/fix-sell-20260812-gsec-0001-allocations.js --execute              # apply
 *   node scripts/fix-sell-20260812-gsec-0001-allocations.js --execute --allow-overallocation
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { getGsecReport } = require('../services/gsecReportService');
const { postFinalApprovedSellLedger } = require('../services/gsecApprovalLedgerService');

const SELL = '20260812/GSEC/0001';
const AVAILABILITY_AS_AT = '2026-08-11'; // day before the sell's value date

// Target allocation as instructed. Must total the sell's face value.
const NEW_ALLOCATIONS = [
  // The 13,602,822 at yield 11.4400 is split across the only two lots carrying
  // that yield, since neither can cover it alone.
  { deal_number: '20260701/GSEC/0007', amountToSell: 7974622 },
  { deal_number: '20260701/GSEC/0008', amountToSell: 5628200 },
  { deal_number: '20260730/GSEC/0002', amountToSell: 2347297 },
  { deal_number: '20260806/GSEC/0002', amountToSell: 2030053 },
  { deal_number: '20260701/GSEC/0004', amountToSell: 50000000 },
  { deal_number: '20260701/GSEC/0005', amountToSell: 32019828 }
];

const EXECUTE = process.argv.includes('--execute');
const ALLOW_OVER = process.argv.includes('--allow-overallocation');

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unformat = (s) => Number(String(s == null ? '' : s).replace(/,/g, '')) || 0;

function parseAllocations(raw) {
  if (!raw) return [];
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function allocSum(list) {
  return list.reduce((s, a) => s + (Number(a.amountToSell || a.faceValue) || 0), 0);
}

async function loadSell() {
  const [rows] = await db.query(
    `SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = 'Sell' LIMIT 1`,
    [SELL]
  );
  if (!rows.length) throw new Error(`Sell ${SELL} not found`);
  return rows[0];
}

/** Authoritative pre-sell balance per lot: the GSEC report as at the prior day. */
async function loadAvailability() {
  const res = await getGsecReport({ asAtDate: AVAILABILITY_AS_AT, pageSize: 100000 });
  const rows = res.rows || res.data || [];
  const map = {};
  rows.forEach((r) => {
    const dn = String(r.deal_number || '').trim();
    if (dn) map[dn] = unformat(r.face_value);
  });
  return map;
}

async function currentLedger() {
  const [rows] = await db.query(
    `SELECT le.id, le.deal_number, le.entry_date, le.account_id, le.debit_amount, le.credit_amount,
            le.description, coa.account_code, coa.name AS account_name
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE le.deal_number = ?
     ORDER BY le.id`,
    [SELL]
  );
  return rows;
}

function printJournal(title, drLines, crLines) {
  console.log(`\n  ${title}`);
  let dr = 0;
  let cr = 0;
  drLines.forEach((l) => {
    dr += Number(l.amount) || 0;
    console.log(`    DR ${String(l.account_code).padEnd(22)} ${fmt(l.amount).padStart(18)}`);
  });
  crLines.forEach((l) => {
    cr += Number(l.amount) || 0;
    console.log(`    CR ${String(l.account_code).padEnd(22)} ${fmt(l.amount).padStart(18)}`);
  });
  console.log(`    ${''.padEnd(25)} DR ${fmt(dr)} / CR ${fmt(cr)}${Math.abs(dr - cr) > 0.005 ? '   *** OUT OF BALANCE ***' : ''}`);
  return { dr, cr };
}

(async () => {
  const sell = await loadSell();
  const sellFace = Number(sell.face_value) || 0;
  const oldAllocations = parseAllocations(sell.sell_deal_allocations);

  console.log(`=== ${SELL} (gsec.id ${sell.id}) ===`);
  console.log(`  face value       ${fmt(sellFace)}`);
  console.log(`  settlement       ${fmt(sell.settlement_amount)}`);
  console.log(`  value date       ${new Date(sell.value_date).toISOString().slice(0, 10)}`);
  console.log(`  status           ${sell.status}`);

  console.log('\n=== current allocation ===');
  oldAllocations.forEach((a) =>
    console.log(`  ${String(a.deal_number).padEnd(22)} ${fmt(a.amountToSell).padStart(18)}`)
  );
  const oldTotal = allocSum(oldAllocations);
  console.log(`  ${'TOTAL'.padEnd(22)} ${fmt(oldTotal).padStart(18)}   (${fmt(oldTotal - sellFace)} vs face)`);

  const avail = await loadAvailability();

  console.log(`\n=== proposed allocation vs available as at ${AVAILABILITY_AS_AT} ===`);
  const overAllocated = [];
  NEW_ALLOCATIONS.forEach((a) => {
    const have = avail[a.deal_number];
    const amt = Number(a.amountToSell) || 0;
    const haveTxt = have == null ? 'lot not on report' : fmt(have);
    let flag = '';
    if (have != null && amt > have + 0.005) {
      flag = `   *** EXCEEDS AVAILABLE BY ${fmt(amt - have)} ***`;
      overAllocated.push({ ...a, available: have, excess: amt - have });
    }
    console.log(`  ${String(a.deal_number).padEnd(22)} ${fmt(amt).padStart(18)}   available ${haveTxt.padStart(16)}${flag}`);
  });
  const newTotal = allocSum(NEW_ALLOCATIONS);
  console.log(`  ${'TOTAL'.padEnd(22)} ${fmt(newTotal).padStart(18)}`);

  if (Math.abs(newTotal - sellFace) > 0.005) {
    throw new Error(
      `Proposed allocation totals ${fmt(newTotal)} but the deal face value is ${fmt(sellFace)}. Refusing to continue.`
    );
  }
  console.log(`  allocation ties to face value.`);

  // Lots touched by either the old or the new allocation need their balance resynced.
  const touched = [
    ...new Set([
      ...oldAllocations.map((a) => String(a.deal_number).trim()),
      ...NEW_ALLOCATIONS.map((a) => String(a.deal_number).trim())
    ])
  ].filter(Boolean);

  const newByDeal = {};
  NEW_ALLOCATIONS.forEach((a) => {
    newByDeal[String(a.deal_number).trim()] = Number(a.amountToSell) || 0;
  });

  const [storedRows] = await db.query(
    `SELECT TRIM(deal_number) AS deal_number, remaining_face_value
     FROM gsec
     WHERE transaction_type = 'Buy' AND TRIM(deal_number) IN (${touched.map(() => '?').join(',')})`,
    touched
  );
  const storedByDeal = {};
  storedRows.forEach((r) => {
    storedByDeal[r.deal_number] = Number(r.remaining_face_value);
  });

  console.log('\n=== remaining_face_value resync ===');
  const resync = [];
  touched.forEach((dn) => {
    const have = avail[dn];
    if (have == null) {
      console.log(`  ${dn.padEnd(22)} skipped (not on the ${AVAILABILITY_AS_AT} report)`);
      return;
    }
    const target = Math.max(0, have - (newByDeal[dn] || 0));
    const stored = storedByDeal[dn];
    const changes = !(Number.isFinite(stored) && Math.abs(stored - target) < 0.005);
    resync.push({ deal_number: dn, target });
    console.log(
      `  ${dn.padEnd(22)} available ${fmt(have).padStart(16)}  allocated ${fmt(newByDeal[dn] || 0).padStart(16)}  ` +
        `stored ${fmt(stored).padStart(16)} -> ${fmt(target).padStart(16)}${changes ? '  (changes)' : ''}`
    );
  });

  const before = await currentLedger();
  console.log(`\n=== existing ledger for ${SELL}: ${before.length} line(s) ===`);
  let bdr = 0;
  let bcr = 0;
  before.forEach((r) => {
    bdr += Number(r.debit_amount) || 0;
    bcr += Number(r.credit_amount) || 0;
    console.log(
      `  id=${String(r.id).padEnd(6)} ${String(r.account_code || '').padEnd(22)} ` +
        `DR ${fmt(r.debit_amount).padStart(16)} CR ${fmt(r.credit_amount).padStart(16)}  ${r.description}`
    );
  });
  console.log(`  totals DR ${fmt(bdr)} / CR ${fmt(bcr)}${Math.abs(bdr - bcr) > 0.005 ? '   (out of balance)' : ''}`);

  // Preview the replacement journal from the new allocation.
  const patched = { ...sell, sell_deal_allocations: JSON.stringify(NEW_ALLOCATIONS) };
  const preview = await postFinalApprovedSellLedger(patched, { dryRun: true });
  if (!preview.success) throw new Error(`Ledger preview failed: ${preview.error}`);

  console.log('\n=== replacement ledger preview ===');
  printJournal('main journal:', preview.main.dr_lines, preview.main.cr_lines);
  if (preview.reversal) {
    printJournal('accrued interest reversal:', preview.reversal.dr_lines, preview.reversal.cr_lines);
  }
  if (preview.computed) {
    const c = preview.computed;
    console.log(
      `\n  components: treasuryBonds ${fmt(c.treasuryBondsAmt)} | accruedAtPurchase ${fmt(c.accruedAtPurchaseAmt)} | ` +
        `amort ${fmt(c.amortToSell)} | holdingCoupon ${fmt(c.holdingCouponIncome)} | capitalGL ${fmt(c.capitalGl)}`
    );
  }

  if (overAllocated.length) {
    console.log('\n*** WARNING: over-allocated lots ***');
    overAllocated.forEach((o) =>
      console.log(
        `  ${o.deal_number} is allocated ${fmt(o.amountToSell)} but only ${fmt(o.available)} is available ` +
          `(excess ${fmt(o.excess)}). Its balance will clamp at zero, so ${fmt(o.excess)} of the sale ` +
          `has no inventory behind it and holdings stay overstated by that amount.`
      )
    );
  }

  if (!EXECUTE) {
    console.log('\nDRY RUN. Nothing was changed. Re-run with --execute to apply.');
    process.exit(0);
  }

  if (overAllocated.length && !ALLOW_OVER) {
    throw new Error(
      'Refusing to execute while lots are over-allocated. Re-run with --allow-overallocation to proceed anyway.'
    );
  }

  // Back the existing lines up so the delete is reversible.
  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `ledger-${SELL.replace(/\//g, '-')}-${new Date().toISOString().replace(/[:.]/g, '')}.json`
  );
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ deal_number: SELL, old_allocations: oldAllocations, ledger_entries: before }, null, 2),
    'utf8'
  );
  console.log(`\nBacked up ${before.length} ledger line(s) and the old allocation to ${backupFile}`);

  await db.query(
    `UPDATE gsec SET sell_deal_allocations = ?, updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(NEW_ALLOCATIONS), sell.id]
  );
  console.log('Updated sell_deal_allocations.');

  const [del] = await db.query('DELETE FROM ledger_entries WHERE deal_number = ?', [SELL]);
  console.log(`Deleted ${del.affectedRows ?? 0} ledger line(s).`);

  const refreshed = await loadSell();
  const posted = await postFinalApprovedSellLedger(refreshed, {});
  if (!posted.success) throw new Error(`Repost failed: ${posted.error}`);
  console.log('Reposted sale ledger.');

  for (const r of resync) {
    await db.query(
      `UPDATE gsec SET remaining_face_value = ?, updated_at = NOW()
       WHERE transaction_type = 'Buy' AND TRIM(deal_number) = ?`,
      [r.target, r.deal_number]
    );
  }
  console.log(`Resynced remaining_face_value on ${resync.length} lot(s).`);

  const after = await currentLedger();
  let adr = 0;
  let acr = 0;
  after.forEach((r) => {
    adr += Number(r.debit_amount) || 0;
    acr += Number(r.credit_amount) || 0;
  });
  console.log(`\n=== ledger after repost: ${after.length} line(s) ===`);
  after.forEach((r) =>
    console.log(
      `  id=${String(r.id).padEnd(6)} ${String(r.account_code || '').padEnd(22)} ` +
        `DR ${fmt(r.debit_amount).padStart(16)} CR ${fmt(r.credit_amount).padStart(16)}  ${r.description}`
    )
  );
  console.log(`  totals DR ${fmt(adr)} / CR ${fmt(acr)}${Math.abs(adr - acr) > 0.005 ? '   *** OUT OF BALANCE ***' : '   (balanced)'}`);
  console.log('\nDone.');
  process.exit(0);
})().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
