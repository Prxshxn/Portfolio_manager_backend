#!/usr/bin/env node
'use strict';

/**
 * Correct BB20260618002: allocation 20,805,160 is authoritative.
 * Leg1/leg2 face and leg2 GSEC must match; revert prior wrong RFV adjustment.
 *
 * Usage: node scripts/fix-bb20260618002-face-allocation.js [--execute]
 */

const db = require('../config/database');
const { computeGsecDailyAmortization } = require('../services/gsecCouponPeriod');

const EXECUTE = process.argv.includes('--execute');
const BB_ID = 146;
const SOURCE_BUY = '20260611/GSEC/0001';
const GSEC_LEG2_ID = 511;
const CORRECT_FACE = 20805160;
const WRONG_FACE = 20805139.07;

function scaleMoney(amount, oldFace, newFace) {
  const n = parseFloat(amount);
  const oldF = parseFloat(oldFace);
  if (!Number.isFinite(n) || !Number.isFinite(oldF) || oldF <= 0) return amount;
  return (Math.round((n * newFace / oldF) * 100) / 100).toFixed(2);
}

(async () => {
  const [bb] = await db.query('SELECT * FROM buyback_deals WHERE id = ?', [BB_ID]);
  const [src] = await db.query(
    'SELECT id, remaining_face_value FROM gsec WHERE deal_number = ? AND transaction_type = ?',
    [SOURCE_BUY, 'Buy']
  );
  const [g2] = await db.query('SELECT * FROM gsec WHERE id = ?', [GSEC_LEG2_ID]);
  if (!bb.length || !src.length || !g2.length) throw new Error('Required rows not found');

  const leg1Settlement = scaleMoney(bb[0].leg1_settlement_amount, WRONG_FACE, CORRECT_FACE);
  const leg2Settlement = scaleMoney(bb[0].leg2_settlement_amount, WRONG_FACE, CORRECT_FACE);
  const newAlloc = JSON.stringify([{ deal_number: SOURCE_BUY, amountToSell: CORRECT_FACE }]);

  // Revert mistaken +20.93 RFV restore from prior fix
  const currentRfv = parseFloat(src[0].remaining_face_value);
  const correctRfv = Math.trunc((currentRfv - (CORRECT_FACE - WRONG_FACE)) * 10000) / 10000;

  const g = g2[0];
  const clean = parseFloat(g.clean_price);
  const dirty = parseFloat(g.dirty_price);
  const accruedPer100 = Math.round((dirty - clean) * 10000) / 10000;
  const amort = computeGsecDailyAmortization({
    face_value: CORRECT_FACE,
    remaining_face_value: CORRECT_FACE,
    clean_price: clean,
    value_date: g.value_date,
    maturity_date: g.maturity_date
  });

  console.log('=== Planned ===');
  console.log('Buyback leg1/leg2 face ->', CORRECT_FACE);
  console.log('leg1 settlement ->', leg1Settlement, 'leg2 settlement ->', leg2Settlement);
  console.log('allocations ->', newAlloc);
  console.log('Source RFV ->', correctRfv.toFixed(4), '(from', currentRfv, ')');
  console.log('Leg2 GSEC face/RFV ->', CORRECT_FACE, 'settlement ->', leg2Settlement);
  console.log('Leg2 accrued per 100 ->', accruedPer100);

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  await db.query(
    `UPDATE buyback_deals
     SET leg1_face_value = ?, leg1_adjusted_face_value = ?,
         leg2_face_value = ?, leg2_adjusted_face_value = ?,
         leg1_settlement_amount = ?, leg2_settlement_amount = ?,
         sell_deal_allocations = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      CORRECT_FACE.toFixed(2),
      CORRECT_FACE.toFixed(2),
      CORRECT_FACE.toFixed(2),
      CORRECT_FACE.toFixed(2),
      leg1Settlement,
      leg2Settlement,
      newAlloc,
      BB_ID
    ]
  );

  await db.query(
    'UPDATE gsec SET remaining_face_value = ?, updated_at = NOW() WHERE id = ?',
    [correctRfv.toFixed(4), src[0].id]
  );

  await db.query(
    `UPDATE gsec
     SET face_value = ?, remaining_face_value = ?, settlement_amount = ?,
         accrued_interest = ?, per_day_amortization = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      CORRECT_FACE.toFixed(6),
      CORRECT_FACE.toFixed(4),
      leg2Settlement,
      accruedPer100,
      amort.ok ? amort.dailyAmount : g.per_day_amortization,
      GSEC_LEG2_ID
    ]
  );

  const [bbA] = await db.query(
    'SELECT leg1_face_value, leg2_face_value, leg2_settlement_amount, sell_deal_allocations FROM buyback_deals WHERE id = ?',
    [BB_ID]
  );
  const [srcA] = await db.query('SELECT remaining_face_value FROM gsec WHERE id = ?', [src[0].id]);
  const [g2A] = await db.query(
    'SELECT face_value, remaining_face_value, settlement_amount, accrued_interest FROM gsec WHERE id = ?',
    [GSEC_LEG2_ID]
  );
  console.log('\n=== After ===');
  console.log('Buyback:', bbA[0]);
  console.log('Source RFV:', srcA[0].remaining_face_value);
  console.log('Leg2 GSEC:', g2A[0]);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
