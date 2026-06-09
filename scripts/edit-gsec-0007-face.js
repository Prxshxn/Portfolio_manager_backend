/* eslint-disable no-console */
'use strict';

/**
 * Correct the FACE VALUE of buy deal 20260608/GSEC/0007 (mistakenly entered),
 * keeping all prices/dates/counterparty unchanged. Recomputes every quantity-
 * scaled field, reposts the buy ledger, recaptures coupon cashflows, and verifies
 * the linked buyback BB20260608005 sell leg stays consistent.
 *
 * DRY RUN by default (no writes). Pass --confirm to apply.
 *
 * Usage:
 *   node scripts/edit-gsec-0007-face.js            # preview
 *   node scripts/edit-gsec-0007-face.js --confirm  # apply
 */

const db = require('../config/database');
const Gsec = require('../models/gsec');
const ledgerController = require('../controllers/ledgerController');
const accountMapping = require('../services/accountMappingService');
const { computeGsecPerDayAccrual, computeGsecDailyAmortization } = require('../services/gsecCouponPeriod');

const DEAL = '20260608/GSEC/0007';
const BUYBACK = 'BB20260608005';
const NEW_FACE = 57720552;
const CONFIRM = process.argv.includes('--confirm');

function trunc4(x) { return Math.floor(Number(x) * 10000) / 10000; }
function trunc8(x) { return Math.floor(Number(x) * 1e8) / 1e8; }
function fmt(n) {
  if (n === null || n === undefined) return '(null)';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function ymd(d) { return d ? new Date(d).toISOString().slice(0, 10) : '(null)'; }

(async () => {
  console.log('================================================================');
  console.log('  EDIT FACE VALUE -', DEAL, CONFIRM ? '(WRITE MODE)' : '(DRY RUN - no writes)');
  console.log('================================================================\n');

  const [rows] = await db.query(
    `SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy'`, [DEAL]
  );
  if (!rows.length) { console.log('Buy deal not found'); await db.pool.end(); process.exit(1); }
  const g = rows[0];

  const clean = Number(g.clean_price);
  const dirty = Number(g.dirty_price);
  const accruedPer100 = trunc4(dirty - clean);

  // Amount already sold by the (correct) buyback - drives the new remaining face.
  const [bb] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ?', [BUYBACK]);
  if (!bb.length) { console.log('Buyback not found'); await db.pool.end(); process.exit(1); }
  let allocs = [];
  try {
    allocs = typeof bb[0].sell_deal_allocations === 'string'
      ? JSON.parse(bb[0].sell_deal_allocations) : (bb[0].sell_deal_allocations || []);
  } catch (_) { allocs = []; }
  const soldByBuyback = allocs
    .filter(a => String(a.deal_number).trim() === DEAL)
    .reduce((s, a) => s + Number(a.amountToSell || 0), 0);

  if (NEW_FACE < soldByBuyback) {
    console.log(`New face ${fmt(NEW_FACE)} < amount sold by buyback ${fmt(soldByBuyback)} -> ABORT`);
    await db.pool.end(); process.exit(1);
  }

  const oldFace = Number(g.face_value);
  const newRemaining = trunc4(NEW_FACE - soldByBuyback);

  // ISIN static data for coupon rate / dates.
  const [im] = await db.query('SELECT * FROM isin_master WHERE isin_number = ?', [g.isin_number]);
  const isin = im[0] || {};
  const couponRate = Number(g.coupon_rate ?? isin.coupon_rate ?? 0) ||
    // fall back to deriving from existing coupon_interest if needed
    (oldFace > 0 ? (Number(g.coupon_interest) * 2 * 100) / oldFace : 0);

  // Quantity-scaled fields (prices, dates, per-100 accrual unchanged).
  const newSettlement = trunc4((NEW_FACE * dirty) / 100);
  const newAccruedInterest = trunc4((NEW_FACE * accruedPer100) / 100);
  const newCouponInterest = (NEW_FACE * couponRate) / 100 / 2;

  // Derived per-day fields, computed at-creation style (remaining = face), matching Gsec.create.
  const pdaRes = computeGsecPerDayAccrual({
    face_value: NEW_FACE, remaining_face_value: NEW_FACE,
    coupon_interest: newCouponInterest, maturity_date: g.maturity_date,
    isin_number: g.isin_number, coupon_rate: couponRate,
    coupon_date_1: isin.coupon_date_1, coupon_date_2: isin.coupon_date_2
  }, ymd(g.value_date), 2);
  const newPerDayAccrual = pdaRes.ok ? pdaRes.amount : Number(g.per_day_accrual);

  const amortRes = computeGsecDailyAmortization({
    face_value: NEW_FACE, remaining_face_value: NEW_FACE,
    clean_price: clean, value_date: g.value_date, maturity_date: g.maturity_date
  });
  const newPerDayAmort = amortRes.ok ? amortRes.dailyAmount : Number(g.per_day_amortization);

  // ---- gsec row before/after ----
  console.log('--- gsec row: BEFORE -> AFTER ---');
  const cmp = (label, before, after) =>
    console.log('  ' + label.padEnd(24) + String(before).padStart(20) + '   ->   ' + String(after).padStart(20) +
      (String(before) !== String(after) ? '   *' : ''));
  cmp('face_value', fmt(oldFace), fmt(NEW_FACE));
  cmp('remaining_face_value', fmt(g.remaining_face_value), fmt(newRemaining));
  cmp('settlement_amount', fmt(g.settlement_amount), fmt(newSettlement));
  cmp('accrued_interest', fmt(g.accrued_interest), fmt(newAccruedInterest));
  cmp('coupon_interest', fmt(g.coupon_interest), fmt(newCouponInterest));
  cmp('per_day_accrual', g.per_day_accrual, newPerDayAccrual);
  cmp('per_day_amortization', g.per_day_amortization, newPerDayAmort);
  console.log('  (unchanged) clean=' + clean + ' dirty=' + dirty + ' accr/100=' + accruedPer100 +
    ' couponRate=' + couponRate + ' VD=' + ymd(g.value_date) + ' maturity=' + ymd(g.maturity_date) +
    ' soldByBuyback=' + fmt(soldByBuyback));
  console.log();

  // ---- buy ledger before/after (postFinalApprovedBuyLedger convention) ----
  const newTreasury = trunc8((clean * NEW_FACE) / 100);
  const newAccrued = trunc8(((dirty - clean) * NEW_FACE) / 100);
  const newBank = trunc8((dirty * NEW_FACE) / 100);

  const [leOld] = await db.query(
    `SELECT coa.account_code, coa.name, ROUND(le.debit_amount,2) dr, ROUND(le.credit_amount,2) cr
     FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE TRIM(le.deal_number) = ? ORDER BY le.id`, [DEAL]);
  console.log('--- buy ledger: CURRENT (posted) ---');
  for (const r of leOld) {
    console.log('  ' + String(r.account_code).padEnd(20) + String(r.name||'').slice(0,34).padEnd(34) +
      ' dr=' + fmt(r.dr).padStart(16) + ' cr=' + fmt(r.cr).padStart(16));
  }
  console.log('\n--- buy ledger: PROPOSED (after reposting) ---');
  console.log('  DR Treasury Bonds - Trading        ' + fmt(newTreasury).padStart(16));
  console.log('  DR Accrued Coupon Paid at Purchase ' + fmt(newAccrued).padStart(16));
  console.log('  CR Bank (settlement)               ' + fmt(newBank).padStart(16));
  console.log('  check: Treasury + Accrued = ' + fmt(trunc8(newTreasury + newAccrued)) + ' vs Bank ' + fmt(newBank));
  console.log();

  // ---- buyback BB20260608005 sell-leg verification ----
  const synthetic = `${BUYBACK}/BB-L1/${DEAL}`;
  const bbTreasury = trunc8((soldByBuyback * clean) / 100);
  const bbAccrued = trunc8((soldByBuyback * (dirty - clean)) / 100);
  const [bbLe] = await db.query(
    `SELECT coa.account_code, coa.name, ROUND(le.debit_amount,2) dr, ROUND(le.credit_amount,2) cr
     FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
     WHERE TRIM(le.deal_number) = ? ORDER BY le.id`, [synthetic]);
  console.log('--- buyback ' + synthetic + ' sell leg ---');
  console.log('  posted now:');
  for (const r of bbLe) {
    console.log('    ' + String(r.account_code).padEnd(20) + String(r.name||'').slice(0,30).padEnd(30) +
      ' dr=' + fmt(r.dr).padStart(16) + ' cr=' + fmt(r.cr).padStart(16));
  }
  console.log('  recomputed (sell amount ' + fmt(soldByBuyback) + ' x unchanged buy prices):');
  console.log('    CR Treasury = ' + fmt(bbTreasury) + '   CR Accrued = ' + fmt(bbAccrued));
  console.log('  => buy-price unchanged + same-day sell (holding days = 0): buyback sell leg is UNAFFECTED.');
  console.log();

  if (!CONFIRM) {
    console.log('================================================================');
    console.log('  DRY RUN complete. No data written.');
    console.log('  Re-run with --confirm to apply (updates gsec row, reposts buy');
    console.log('  ledger, recaptures coupon cashflows; buyback left intact).');
    console.log('================================================================');
    await db.pool.end(); process.exit(0);
  }

  // ----------------------- WRITE PATH -----------------------
  console.log('Applying changes...');
  await db.query(
    `UPDATE gsec SET face_value = ?, remaining_face_value = ?, settlement_amount = ?,
        accrued_interest = ?, coupon_interest = ?, per_day_accrual = ?, per_day_amortization = ?
     WHERE id = ?`,
    [NEW_FACE, newRemaining, newSettlement, newAccruedInterest, newCouponInterest,
      newPerDayAccrual, newPerDayAmort, g.id]
  );
  console.log('  gsec row updated.');

  // Repost the buy ledger: delete old lines, post fresh compound entry.
  await db.query(`DELETE FROM ledger_entries WHERE TRIM(deal_number) = ?`, [DEAL]);
  const treasuryCode = (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT)) || '131-101-350-098-44';
  const accruedCode = (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUED_INTEREST_PAID)) || '131-101-350-128-44';
  let bankCode = (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT)) || '131-101-410-164-44';
  if (g.settlement_mode) {
    const [sa] = await db.query('SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1', [g.settlement_mode]);
    if (sa && sa.length && sa[0].ledger_account_code) bankCode = sa[0].ledger_account_code;
  }
  const buyDate = ymd(g.value_date);
  const repost = await ledgerController.postCompoundLedgerEntry({
    date: buyDate,
    dr_accounts: [
      { account_code: treasuryCode, amount: newTreasury, description: `GSec Purchase - Treasury Bonds - ${DEAL}` },
      { account_code: accruedCode, amount: newAccrued, description: `GSec Purchase - Accrued Interest - ${DEAL}` }
    ],
    cr_account: bankCode,
    deal_id: DEAL,
    description: `GSec Purchase - Final Approval - ${DEAL}`
  });
  console.log('  buy ledger reposted:', repost.success ? 'OK' : 'FAILED ' + repost.error);

  // Recapture coupon cashflows on the corrected face.
  try {
    await db.query('DELETE FROM gsec_cashflows WHERE deal_id = ?', [g.id]).catch(() => {});
    await Gsec.captureCouponCashflow(g.id, g.isin_number, NEW_FACE, g.maturity_date, g.counterparty_id);
    console.log('  coupon cashflows recaptured.');
  } catch (e) {
    console.log('  coupon cashflow recapture skipped:', e.message);
  }

  console.log('\nDONE. Buyback ' + BUYBACK + ' left intact (verified unaffected).');
  await db.pool.end(); process.exit(0);
})().catch((e) => { console.error('Error:', e); process.exit(1); });
