#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const db = require('../config/database');

const BUY = '20260701/GSEC/0007';
const SELLS = ['20260706/GSEC/0002', '20260710/GSEC/0002', '20260710/GSEC/0004'];

async function main() {
  const [buyRows] = await db.query(
    `SELECT deal_number, transaction_type, status, face_value, remaining_face_value,
            value_date, isin_number, buy_deal_number, sell_deal_allocations
     FROM gsec WHERE deal_number = ?`,
    [BUY]
  );
  console.log('\n=== BUY DEAL ===');
  console.log(JSON.stringify(buyRows, null, 2));

  const [sellRows] = await db.query(
    `SELECT deal_number, transaction_type, status, face_value, remaining_face_value,
            value_date, buy_deal_number, sell_deal_allocations, settlement_amount
     FROM gsec WHERE deal_number IN (?) ORDER BY value_date, deal_number`,
    [SELLS]
  );
  console.log('\n=== RELATED SELLS ===');
  console.log(JSON.stringify(sellRows, null, 2));

  const [sellsAgainstBuy] = await db.query(
    `SELECT deal_number, status, face_value, value_date, sell_deal_allocations
     FROM gsec
     WHERE transaction_type = 'Sell' AND buy_deal_number = ?
     ORDER BY value_date, deal_number`,
    [BUY]
  );
  console.log('\n=== ALL SELLS LINKED TO BUY ===');
  console.log(JSON.stringify(sellsAgainstBuy, null, 2));

  const [bbRows] = await db.query(
    `SELECT deal_number, deal_status, source_buy_deal_number, leg1_face_value,
            leg1_adjusted_face_value, sell_deal_allocations, approved_at, leg1_value_date
     FROM buyback_deals
     WHERE source_buy_deal_number = ?
        OR sell_deal_allocations LIKE ?
     ORDER BY approved_at`,
    [BUY, `%${BUY}%`]
  );
  console.log('\n=== BUYBACKS AGAINST BUY ===');
  console.log(JSON.stringify(bbRows, null, 2));

  const originalFace = Number(buyRows[0]?.face_value || 0);
  const storedRfv = Number(buyRows[0]?.remaining_face_value || 0);
  let soldTotal = 0;
  for (const s of sellsAgainstBuy) {
    if (String(s.status).toLowerCase() === 'rejected') continue;
    soldTotal += Number(s.face_value) || 0;
  }

  let allocTotal = 0;
  for (const s of sellsAgainstBuy) {
    if (String(s.status).toLowerCase() === 'rejected') continue;
    let allocs = s.sell_deal_allocations;
    if (typeof allocs === 'string') {
      try { allocs = JSON.parse(allocs); } catch { allocs = null; }
    }
    if (Array.isArray(allocs)) {
      for (const a of allocs) {
        if ((a.deal_number || a.buy_deal_number) === BUY) {
          allocTotal += Number(a.amountToSell || a.faceValue) || 0;
        }
      }
    } else if (s.buy_deal_number === BUY) {
      allocTotal += Number(s.face_value) || 0;
    }
  }

  let bbTotal = 0;
  for (const r of bbRows) {
    if (String(r.deal_status) !== 'Approved') continue;
    let allocs = r.sell_deal_allocations;
    if (typeof allocs === 'string') {
      try { allocs = JSON.parse(allocs); } catch { allocs = null; }
    }
    if (Array.isArray(allocs) && allocs.length) {
      for (const a of allocs) {
        if ((a.deal_number || a.buy_deal_number) === BUY) {
          bbTotal += Number(a.amountToSell || a.faceValue) || 0;
        }
      }
    } else if (r.source_buy_deal_number === BUY) {
      bbTotal += Number(r.leg1_face_value) || 0;
    }
  }

  const perSellImpact = [];
  let running = originalFace;
  for (const s of sellsAgainstBuy) {
    if (String(s.status).toLowerCase() === 'rejected') continue;
    let deducted = Number(s.face_value) || 0;
    let allocs = s.sell_deal_allocations;
    if (typeof allocs === 'string') {
      try { allocs = JSON.parse(allocs); } catch { allocs = null; }
    }
    if (Array.isArray(allocs) && allocs.length) {
      deducted = 0;
      for (const a of allocs) {
        if ((a.deal_number || a.buy_deal_number) === BUY) {
          deducted += Number(a.amountToSell || a.faceValue) || 0;
        }
      }
    }
    running -= deducted;
    perSellImpact.push({
      sell: s.deal_number,
      value_date: s.value_date,
      sell_face_value: Number(s.face_value),
      deducted_from_buy: deducted,
      remaining_after: running
    });
  }

  const [buy0003] = await db.query(
    `SELECT deal_number, face_value, remaining_face_value FROM gsec WHERE deal_number = '20260710/GSEC/0003'`
  );

  console.log('\n=== STEP-BY-STEP DEDUCTION FROM BUY ===');
  console.log(JSON.stringify(perSellImpact, null, 2));

  console.log('\n=== OTHER BUY IN MULTI-LOT SELL 0004 ===');
  console.log(JSON.stringify(buy0003, null, 2));

  console.log('\n=== RECONCILIATION ===');
  console.log({
    originalFace,
    storedRfv,
    impliedDeduction: originalFace - storedRfv,
    soldTotalFaceOnLinkedSells: soldTotal,
    correctDeductionFromAllocations: originalFace - storedRfv,
    naiveOvercountIfUsingSellFaceValue: soldTotal - (originalFace - storedRfv),
    buybackDeduction: bbTotal
  });

  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
