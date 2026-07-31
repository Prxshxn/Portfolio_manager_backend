#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Retro-correct T-Bill settlement_amount (and matching Buy/Sell ledger lines)
 * so cash is rounded UP to the nearest ones place.
 *
 *   node scripts/retro-tbill-ceil-settlement.js           # dry run
 *   node scripts/retro-tbill-ceil-settlement.js --commit  # apply
 */
const db = require('../config/database');
const tbillPricing = require('../services/tbillPricingService');

const COMMIT = process.argv.includes('--commit');

function ymd(d) {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

function near(a, b, tol = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function resolveCorrectSettlement(row) {
  const current = Number(row.settlement_amount);
  if (row.value_date && row.maturity_date && row.face_value != null && row.discount_rate_pct != null) {
    const priced = tbillPricing.compute({
      valueDate: ymd(row.value_date),
      maturityDate: ymd(row.maturity_date),
      faceValue: row.face_value,
      discountRatePercent: row.discount_rate_pct
    });
    if (priced.ok && Number.isFinite(priced.cashPrice)) {
      return {
        target: priced.cashPrice,
        source: 'reprice',
        cashPriceRaw: priced.cashPriceRaw,
        pricePer100: priced.pricePer100
      };
    }
  }
  return {
    target: tbillPricing.ceilSettlementToOnes(current),
    source: 'ceil_current',
    cashPriceRaw: current,
    pricePer100: row.price_per_100 != null ? Number(row.price_per_100) : null
  };
}

async function main() {
  console.log(COMMIT ? 'MODE: COMMIT' : 'MODE: DRY RUN');

  const [rows] = await db.query(
    `SELECT id, deal_number, transaction_type, status, face_value, settlement_amount,
            discount_rate_pct, price_per_100, value_date, maturity_date
     FROM tbill
     WHERE settlement_amount IS NOT NULL
       AND ABS(settlement_amount - ROUND(settlement_amount)) > 0.00001
     ORDER BY value_date, id`
  );

  if (!rows.length) {
    console.log('No non-integer T-Bill settlement amounts found.');
    if (typeof db.end === 'function') await db.end();
    return;
  }

  const plan = [];
  for (const row of rows) {
    const current = Number(row.settlement_amount);
    const resolved = resolveCorrectSettlement(row);
    const target = resolved.target;
    const delta = Math.round((target - current) * 100) / 100;

    if (!(delta > 0)) {
      plan.push({
        id: row.id,
        deal_number: row.deal_number,
        transaction_type: row.transaction_type,
        status: row.status,
        current,
        target,
        delta,
        source: resolved.source,
        pricePer100: resolved.pricePer100,
        action: 'skip_no_increase',
        ledger: []
      });
      continue;
    }

    const [ledger] = row.deal_number
      ? await db.query(
          `SELECT le.id, le.entry_date, coa.account_code, le.debit_amount, le.credit_amount, le.description
           FROM ledger_entries le
           LEFT JOIN chart_of_accounts coa ON coa.id = le.account_id
           WHERE le.deal_number = ?
             AND (
               le.description LIKE 'T-Bill Purchase%'
               OR le.description LIKE 'T-Bill Sale%'
               OR le.description LIKE 'TBill Maturity%'
             )
           ORDER BY le.id`,
          [row.deal_number]
        )
      : [[]];

    const patchLines = [];
    for (const line of ledger) {
      const dr = Number(line.debit_amount) || 0;
      const cr = Number(line.credit_amount) || 0;
      if (dr > 0 && near(dr, current)) {
        patchLines.push({
          id: line.id,
          side: 'debit',
          from: dr,
          to: target,
          account: line.account_code,
          description: line.description
        });
      } else if (cr > 0 && near(cr, current)) {
        patchLines.push({
          id: line.id,
          side: 'credit',
          from: cr,
          to: target,
          account: line.account_code,
          description: line.description
        });
      }
    }

    // Higher sale/buy cash changes the capital G/L plug by the same delta:
    // gain CR increases, or loss DR decreases.
    const gainLossLines = ledger.filter(
      (l) =>
        String(l.description || '').includes('(gain)') ||
        String(l.description || '').includes('(loss)') ||
        l.account_code === '358-101-130-392-44'
    );
    for (const line of gainLossLines) {
      const dr = Number(line.debit_amount) || 0;
      const cr = Number(line.credit_amount) || 0;
      if (cr > 0) {
        patchLines.push({
          id: line.id,
          side: 'credit',
          from: cr,
          to: Math.round((cr + delta) * 100) / 100,
          account: line.account_code,
          description: line.description
        });
      } else if (dr > 0) {
        const next = Math.round((dr - delta) * 100) / 100;
        if (next > 0) {
          patchLines.push({
            id: line.id,
            side: 'debit',
            from: dr,
            to: next,
            account: line.account_code,
            description: line.description
          });
        } else {
          // Loss flips to zero/gain — leave for manual review.
          console.warn(
            `${row.deal_number}: loss plug ${dr} would go to ${next} after +${delta}; review manually`
          );
        }
      }
    }

    plan.push({
      id: row.id,
      deal_number: row.deal_number,
      transaction_type: row.transaction_type,
      status: row.status,
      current,
      target,
      delta,
      source: resolved.source,
      pricePer100: resolved.pricePer100,
      action: 'update',
      ledger: patchLines
    });
  }

  console.log('\nPlan:');
  console.table(
    plan.map((p) => ({
      deal: p.deal_number,
      type: p.transaction_type,
      status: p.status,
      current: p.current,
      target: p.target,
      delta: p.delta,
      action: p.action,
      ledger_patches: p.ledger.length
    }))
  );

  for (const p of plan.filter((x) => x.action === 'update')) {
    if (!p.ledger.length) {
      console.log(
        `\n${p.deal_number}: no ledger lines matched old settlement ${p.current} (deal row will still be updated).`
      );
      continue;
    }
    console.log(`\n${p.deal_number} ledger patches:`);
    console.table(p.ledger);
  }

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit to apply.');
    if (typeof db.end === 'function') await db.end();
    return;
  }

  let updatedDeals = 0;
  let updatedLedger = 0;
  for (const p of plan) {
    if (p.action !== 'update') continue;

    if (p.source === 'reprice' && p.pricePer100 != null) {
      await db.query(
        `UPDATE tbill
         SET settlement_amount = ?,
             price_per_100 = ?,
             clean_price = ?,
             dirty_price = ?
         WHERE id = ?`,
        [p.target, p.pricePer100, p.pricePer100, p.pricePer100, p.id]
      );
    } else {
      await db.query(
        'UPDATE tbill SET settlement_amount = ? WHERE id = ?',
        [p.target, p.id]
      );
    }
    updatedDeals++;

    for (const line of p.ledger) {
      if (line.side === 'debit') {
        await db.query('UPDATE ledger_entries SET debit_amount = ? WHERE id = ?', [line.to, line.id]);
      } else {
        await db.query('UPDATE ledger_entries SET credit_amount = ? WHERE id = ?', [line.to, line.id]);
      }
      updatedLedger++;
    }
  }

  console.log(`\nDone. Updated ${updatedDeals} tbill row(s), ${updatedLedger} ledger line(s).`);
  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
