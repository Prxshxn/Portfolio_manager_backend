#!/usr/bin/env node
'use strict';

/**
 * Re-post the passed ledger entries for GSEC 20260619/GSEC/0002 (id 512) that were
 * computed from the corrupted leg2 clean price (-999902.2622 / accrued 999999.9999).
 *
 * The clean price has already been corrected to 93.9255 on the gsec row. This script:
 *   1. Recomputes per_day_amortization from the corrected clean price and fixes the gsec row.
 *   2. Updates the purchase compound entry (Treasury 453 / Accrued 458 / Bank 464) in place.
 *   3. Updates each posted "Daily Amortization" pair (443 DR / 505 CR) to the corrected daily amount.
 *
 * Daily Accrual entries (568/570) are already correct (per_day_accrual is valid) and left untouched.
 *
 * Usage: node scripts/repost-gsec-0002-corrected-clean.js [--execute]
 */

const db = require('../config/database');
const { computeGsecDailyAmortization } = require('../services/gsecCouponPeriod');

const EXECUTE = process.argv.includes('--execute');
const GSEC_ID = 512;
const DEAL_NUMBER = '20260619/GSEC/0002';

const ACC = { TREASURY: 453, ACCRUED: 458, BANK: 464, AMORT_DR: 443, AMORT_CR: 505 };

function truncate8(x) {
  return Math.floor(Number(x) * 100000000) / 100000000;
}
function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

(async () => {
  const [gRows] = await db.query(
    'SELECT id, deal_number, face_value, clean_price, dirty_price, accrued_interest, settlement_amount, per_day_amortization, value_date, maturity_date FROM gsec WHERE id = ?',
    [GSEC_ID]
  );
  if (!gRows.length) throw new Error('GSEC row not found');
  const g = gRows[0];

  const face = Number(g.face_value);
  const clean = Number(g.clean_price);
  const dirty = Number(g.dirty_price);

  if (!(clean > 0 && dirty > 0 && dirty >= clean)) {
    throw new Error(`Refusing to repost: gsec clean/dirty still look wrong (clean=${clean}, dirty=${dirty}). Fix the price first.`);
  }

  // --- 1. Correct per_day_amortization ---
  const amort = computeGsecDailyAmortization({
    face_value: face,
    remaining_face_value: face,
    clean_price: clean,
    value_date: g.value_date,
    maturity_date: g.maturity_date
  });
  if (!amort.ok) throw new Error(`Amortization recompute failed: ${amort.reason}`);
  const newPerDayAmort = amort.dailyAmount;

  // --- 2. Purchase compound entry (senior buy convention, price-derived) ---
  const newAccrued = truncate8(((dirty - clean) * face) / 100);
  const newNet = truncate8((clean * face) / 100);
  const newBank = truncate8((dirty * face) / 100);

  // --- Load current entries ---
  const [entries] = await db.query(
    'SELECT id, account_id, entry_date, debit_amount, credit_amount, description FROM ledger_entries WHERE deal_number = ? ORDER BY id',
    [DEAL_NUMBER]
  );

  const purchaseTreasury = entries.find((e) => e.account_id === ACC.TREASURY);
  const purchaseAccrued = entries.find((e) => e.account_id === ACC.ACCRUED);
  const purchaseBank = entries.find((e) => e.account_id === ACC.BANK);
  const amortDrRows = entries.filter((e) => e.account_id === ACC.AMORT_DR);
  const amortCrRows = entries.filter((e) => e.account_id === ACC.AMORT_CR);

  console.log('=== GSEC', DEAL_NUMBER, '(id', GSEC_ID + ') ===');
  console.log('face:', face, 'clean:', clean, 'dirty:', dirty);
  console.log('\nper_day_amortization:', g.per_day_amortization, '->', newPerDayAmort);

  console.log('\n--- Purchase compound entry ---');
  if (purchaseTreasury) console.log(`  453 Treasury DR : ${purchaseTreasury.debit_amount} -> ${round2(newNet)}`);
  if (purchaseAccrued) console.log(`  458 Accrued  DR : ${purchaseAccrued.debit_amount} -> ${round2(newAccrued)}`);
  if (purchaseBank) console.log(`  464 Bank     CR : ${purchaseBank.credit_amount} -> ${round2(newBank)}`);
  console.log(`  (check) Treasury+Accrued = ${round2(newNet + newAccrued)} vs Bank ${round2(newBank)}`);

  console.log('\n--- Daily Amortization entries (per posted date) ---');
  amortDrRows.forEach((r) => console.log(`  [${String(r.entry_date).slice(0, 10)}] 443 DR ${r.debit_amount} -> ${round2(newPerDayAmort)}`));
  amortCrRows.forEach((r) => console.log(`  [${String(r.entry_date).slice(0, 10)}] 505 CR ${r.credit_amount} -> ${round2(newPerDayAmort)}`));

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query('UPDATE gsec SET per_day_amortization = ?, updated_at = NOW() WHERE id = ?', [newPerDayAmort, GSEC_ID]);

    if (purchaseTreasury) {
      await conn.query('UPDATE ledger_entries SET debit_amount = ?, updated_at = NOW() WHERE id = ?', [round2(newNet), purchaseTreasury.id]);
    }
    if (purchaseAccrued) {
      await conn.query('UPDATE ledger_entries SET debit_amount = ?, updated_at = NOW() WHERE id = ?', [round2(newAccrued), purchaseAccrued.id]);
    }
    if (purchaseBank) {
      await conn.query('UPDATE ledger_entries SET credit_amount = ?, updated_at = NOW() WHERE id = ?', [round2(newBank), purchaseBank.id]);
    }
    for (const r of amortDrRows) {
      await conn.query('UPDATE ledger_entries SET debit_amount = ?, updated_at = NOW() WHERE id = ?', [round2(newPerDayAmort), r.id]);
    }
    for (const r of amortCrRows) {
      await conn.query('UPDATE ledger_entries SET credit_amount = ?, updated_at = NOW() WHERE id = ?', [round2(newPerDayAmort), r.id]);
    }

    await conn.commit();
    console.log('\nApplied. Verifying...');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [after] = await db.query(
    'SELECT id, account_id, entry_date, debit_amount, credit_amount, description FROM ledger_entries WHERE deal_number = ? ORDER BY id',
    [DEAL_NUMBER]
  );
  console.log(JSON.stringify(after, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
