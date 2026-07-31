#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Scan sell ledger postings that should be same-day (holdingDays=0) but have
 * amortisation and/or inflated capital gain lines.
 */

const db = require('../config/database');
const {
  postFinalApprovedSellLedger,
  truncate8,
  utcDayDiffSigned,
  toYmdUtc,
} = require('../services/gsecApprovalLedgerService');

const AMORT_CODES = new Set(['358-101-130-416-44']);
const CAP_CODES = new Set(['358-101-130-398-44']);

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseBuybackL1(dealNumber) {
  const m = String(dealNumber).match(/^(BB\d+)\/BB-L1\/(.+)$/);
  if (!m) return null;
  return { bb: m[1], buyDeal: m[2] };
}

async function loadBuybackSlice(bb, buyDeal) {
  const [rows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ? LIMIT 1', [bb]);
  if (!rows.length) return null;
  const d = rows[0];
  if (String(d.leg1_transaction_type).toLowerCase() !== 'sell') return null;

  const leg1Den =
    Number(d.leg1_adjusted_face_value != null ? d.leg1_adjusted_face_value : d.leg1_face_value) || 0;
  let faceSlice = leg1Den;
  let allocs = d.sell_deal_allocations;
  if (typeof allocs === 'string') {
    try {
      allocs = JSON.parse(allocs);
    } catch {
      allocs = null;
    }
  }
  if (Array.isArray(allocs)) {
    const a = allocs.find((x) => (x.deal_number || x.buy_deal_number) === buyDeal);
    if (a) faceSlice = Number(a.amountToSell) || faceSlice;
  } else if (d.source_buy_deal_number !== buyDeal) {
    return null;
  }

  const ratio = leg1Den > 0 ? faceSlice / leg1Den : 1;
  const synthetic = `${bb}/BB-L1/${buyDeal}`;
  return {
    kind: 'buyback_l1',
    deal_number: synthetic,
    sellLike: {
      deal_number: synthetic,
      buy_deal_number: buyDeal,
      face_value: faceSlice,
      settlement_amount: truncate8(Number(d.leg1_settlement_amount) * ratio),
      accrued_interest: truncate8(Number(d.leg1_accrued_interest || 0) * ratio),
      clean_price: d.leg1_clean_price,
      dirty_price: d.leg1_dirty_price,
      settlement_mode: d.leg1_settlement_mode,
      value_date: d.leg1_value_date,
      trade_date: d.leg1_trade_date || d.leg1_value_date,
      transaction_type: 'Sell',
    },
    descriptionPrefix: `Buyback ${bb} - `,
    sellDate: toYmdUtc(d.leg1_value_date),
  };
}

async function loadGsecSell(dealNumber) {
  const [rows] = await db.query(
    "SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = 'Sell' ORDER BY id",
    [dealNumber]
  );
  if (!rows.length) return null;

  const totalFace = rows.reduce((s, r) => s + Number(r.face_value || 0), 0);
  const dealSettlement = Number(rows[0].settlement_amount || 0);
  const distinctAccrued = [...new Set(rows.map((r) => Number(r.accrued_interest || 0)))];
  const perAllocAccruedMode = distinctAccrued.length === rows.length ? 'as-stored' : 'pro-rate-from-total';
  const dealAccruedTotal = perAllocAccruedMode === 'as-stored'
    ? rows.reduce((s, r) => s + Number(r.accrued_interest || 0), 0)
    : (distinctAccrued[0] || 0);

  const slices = rows.map((sr) => {
    const sellFace = Number(sr.face_value || 0);
    const share = totalFace > 0 ? sellFace / totalFace : 1;
    return {
      ...sr,
      face_value: sellFace,
      settlement_amount: truncate8(dealSettlement * share),
      accrued_interest:
        perAllocAccruedMode === 'as-stored'
          ? truncate8(Number(sr.accrued_interest || 0))
          : truncate8(dealAccruedTotal * share),
    };
  });

  return {
    kind: 'gsec',
    deal_number: dealNumber,
    slices,
    sellDate: toYmdUtc(rows[0].value_date),
  };
}

async function postedSummary(dealNumber) {
  const [rows] = await db.query(
    `SELECT le.debit_amount, le.credit_amount, coa.account_code, coa.name, le.description, le.entry_date
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ?
     ORDER BY le.id`,
    [dealNumber]
  );
  let amort = 0;
  let capital = 0;
  let lines = rows.length;
  rows.forEach((r) => {
    const code = r.account_code || '';
    const net = Number(r.debit_amount || 0) - Number(r.credit_amount || 0);
    if (AMORT_CODES.has(code)) amort += net;
    if (CAP_CODES.has(code)) capital -= net; // CR positive
  });
  return { rows, lines, amort, capital };
}

async function previewCorrect(ctx) {
  const allLines = [];
  if (ctx.kind === 'buyback_l1') {
    const r = await postFinalApprovedSellLedger(ctx.sellLike, {
      descriptionPrefix: ctx.descriptionPrefix,
      dryRun: true,
    });
    if (!r.success) return { error: r.error };
    allLines.push(r);
  } else {
    for (const slice of ctx.slices) {
      const r = await postFinalApprovedSellLedger(slice, { dryRun: true });
      if (!r.success) return { error: r.error };
      allLines.push(r);
    }
  }

  const acc = {};
  const add = (code, dr, cr, desc, date) => {
    const k = `${code}|${desc}`;
    if (!acc[k]) acc[k] = { code, dr: 0, cr: 0, desc, date };
    acc[k].dr += dr;
    acc[k].cr += cr;
  };

  for (const r of allLines) {
    const date = r.date || ctx.sellDate;
    (r.main?.dr_lines || []).forEach((l) => add(l.account_code, l.amount, 0, l.description, date));
    (r.main?.cr_lines || []).forEach((l) => add(l.account_code, 0, l.amount, l.description, date));
    if (r.reversal) {
      (r.reversal.dr_lines || []).forEach((l) => add(l.account_code, l.amount, 0, l.description, date));
      (r.reversal.cr_lines || []).forEach((l) => add(l.account_code, 0, l.amount, l.description, date));
    }
  }

  let amort = 0;
  let capital = 0;
  Object.values(acc).forEach((v) => {
    const net = v.dr - v.cr;
    if (AMORT_CODES.has(v.code)) amort += net;
    if (CAP_CODES.has(v.code)) capital -= net;
  });

  return { lines: Object.values(acc), amort, capital, holdingDays: allLines[0]?.computed?.holdingDays };
}

async function maxHoldingDays(ctx) {
  if (ctx.kind === 'buyback_l1') {
    const [buy] = await db.query(
      "SELECT value_date FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1",
      [ctx.sellLike.buy_deal_number]
    );
    if (!buy.length) return null;
    return utcDayDiffSigned(ctx.sellDate, buy[0].value_date);
  }
  let max = 0;
  for (const slice of ctx.slices) {
    if (!slice.buy_deal_number) continue;
    const [buy] = await db.query(
      "SELECT value_date FROM gsec WHERE deal_number = ? AND transaction_type = 'Buy' LIMIT 1",
      [slice.buy_deal_number]
    );
    if (!buy.length) continue;
    max = Math.max(max, utcDayDiffSigned(ctx.sellDate, buy[0].value_date));
  }
  return max;
}

async function main() {
  const dealNumbers = new Set();

  const [bbL1] = await db.query(
    `SELECT DISTINCT le.deal_number
     FROM ledger_entries le
     WHERE le.deal_number LIKE 'BB%/BB-L1/%'`
  );
  bbL1.forEach((r) => dealNumbers.add(r.deal_number));

  const [gsecLe] = await db.query(
    `SELECT DISTINCT le.deal_number
     FROM ledger_entries le
     INNER JOIN gsec g ON g.deal_number COLLATE utf8mb4_unicode_ci = le.deal_number COLLATE utf8mb4_unicode_ci
       AND g.transaction_type = 'Sell'
     WHERE g.status = 'final_approved'`
  );
  gsecLe.forEach((r) => dealNumbers.add(r.deal_number));

  const candidates = [];

  for (const dn of [...dealNumbers].sort()) {
    const posted = await postedSummary(dn);
    if (!posted.lines) continue;

    const hasBadAmort = Math.abs(posted.amort) > 0.01;
    const hasBadCap = Math.abs(posted.capital) > 1.0;
    if (!hasBadAmort && !hasBadCap) continue;

    let ctx = null;
    const bb = parseBuybackL1(dn);
    if (bb) ctx = await loadBuybackSlice(bb.bb, bb.buyDeal);
    else ctx = await loadGsecSell(dn);
    if (!ctx) continue;

    const hd = await maxHoldingDays(ctx);
    if (hd !== 0) continue; // only same-day exits

    const correct = await previewCorrect(ctx);
    if (correct.error) continue;

    const needsFix =
      Math.abs(posted.amort - correct.amort) > 0.01 ||
      Math.abs(posted.capital - correct.capital) > 0.01;

    if (needsFix) {
      candidates.push({ deal_number: dn, kind: ctx.kind, posted, correct, holdingDays: hd });
    }
  }

  console.log(`Same-day sell ledger mis-posts needing correction: ${candidates.length}\n`);
  for (const c of candidates) {
    console.log('---', c.deal_number, `(${c.kind}) holdingDays=${c.holdingDays}`);
    console.log(
      '  POSTED   amort net', fmt(c.posted.amort),
      '| capital CR', fmt(c.posted.capital),
      `| ${c.posted.lines} lines`
    );
    console.log(
      '  CORRECT  amort net', fmt(c.correct.amort),
      '| capital CR', fmt(c.correct.capital)
    );
  }

  if (require.main === module && typeof db.end === 'function') await db.end();
  return candidates;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main, parseBuybackL1, loadBuybackSlice, loadGsecSell, postedSummary, previewCorrect };
