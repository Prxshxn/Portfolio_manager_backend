#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * READ-ONLY consolidated ledger entry preview for GSEC and Buyback deal numbers.
 * Includes account names (chart_of_accounts) and line descriptions.
 *
 * Usage:
 *   node scripts/preview-deal-ledger-entries.js 20260522/GSEC/0004 BB20260504001 ...
 */

const db = require('../config/database');
const {
  postFinalApprovedSellLedger,
  postFinalApprovedBuyLedger,
  truncate8,
} = require('../services/gsecApprovalLedgerService');
const ledgerController = require('../controllers/ledgerController');
const { postBuySellBuybackLedger } = require('../services/buybackBuySellLedgerService');

const DEALS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!DEALS.length) {
  console.error('Usage: node scripts/preview-deal-ledger-entries.js <deal...>');
  process.exit(1);
}

const accountNames = new Map();

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDateStr(v) {
  if (!v) return '';
  return new Date(v).toISOString().slice(0, 10);
}

function truncStr(s, max) {
  const t = String(s || '');
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`;
}

async function loadAccountNames() {
  const [rows] = await db.query('SELECT account_code, name FROM chart_of_accounts WHERE is_active = TRUE');
  rows.forEach((r) => {
    if (r.account_code) accountNames.set(r.account_code, r.name || '');
  });
}

function acctName(code) {
  if (!code) return '';
  return accountNames.get(code) || '(unknown account)';
}

function makeLine({ account_code, debit, credit, description, entry_date }) {
  return {
    account_code: account_code || '',
    account_name: acctName(account_code),
    debit: Number(debit) || 0,
    credit: Number(credit) || 0,
    description: description || '',
    entry_date: entry_date ? toDateStr(entry_date) : '',
  };
}

function dryRunToLines(result) {
  const lines = [];
  if (!result?.success) return lines;
  const date = result.date || '';
  (result.main?.dr_lines || []).forEach((l) => {
    lines.push(makeLine({
      account_code: l.account_code,
      debit: l.amount,
      credit: 0,
      description: l.description || result.main?.description || '',
      entry_date: date,
    }));
  });
  (result.main?.cr_lines || []).forEach((l) => {
    lines.push(makeLine({
      account_code: l.account_code,
      debit: 0,
      credit: l.amount,
      description: l.description || result.main?.description || '',
      entry_date: date,
    }));
  });
  if (result.reversal) {
    (result.reversal.dr_lines || []).forEach((l) => {
      lines.push(makeLine({
        account_code: l.account_code,
        debit: l.amount,
        credit: 0,
        description: l.description || result.reversal?.description || '',
        entry_date: date,
      }));
    });
    (result.reversal.cr_lines || []).forEach((l) => {
      lines.push(makeLine({
        account_code: l.account_code,
        debit: 0,
        credit: l.amount,
        description: l.description || result.reversal?.description || '',
        entry_date: date,
      }));
    });
  }
  return lines;
}

function consolidateLines(lines) {
  const acc = {};
  lines.forEach((l) => {
    const key = l.account_code;
    if (!acc[key]) {
      acc[key] = {
        account_code: key,
        account_name: l.account_name,
        debit: 0,
        credit: 0,
        descriptions: new Set(),
      };
    }
    acc[key].debit += l.debit;
    acc[key].credit += l.credit;
    if (l.description) acc[key].descriptions.add(l.description);
  });
  return Object.values(acc).map((a) => ({
    account_code: a.account_code,
    account_name: a.account_name,
    debit: truncate8(a.debit),
    credit: truncate8(a.credit),
    description: [...a.descriptions].join(' | '),
    entry_date: '',
  }));
}

function printLinesTable(label, lines) {
  if (!lines.length) {
    console.log(`\n  ${label}: (no lines)`);
    return { dr: 0, cr: 0 };
  }

  console.log(`\n  ${label}`);
  console.log(
    '    ' +
      'Date'.padEnd(12) +
      'Account Code'.padEnd(22) +
      'Account Name'.padEnd(52) +
      'Debit'.padStart(16) +
      'Credit'.padStart(16) +
      '  Description'
  );
  console.log('    ' + '-'.repeat(160));

  let totDr = 0;
  let totCr = 0;
  for (const l of lines) {
    totDr += l.debit;
    totCr += l.credit;
    console.log(
      '    ' +
        (l.entry_date || '').padEnd(12) +
        String(l.account_code).padEnd(22) +
        String(l.account_name || '').padEnd(52) +
        (l.debit ? fmt(l.debit) : '').padStart(16) +
        (l.credit ? fmt(l.credit) : '').padStart(16) +
        '  ' +
        (l.description || '')
    );
  }
  console.log(
    '    ' +
      ''.padEnd(86) +
      fmt(totDr).padStart(16) +
      fmt(totCr).padStart(16)
  );
  return { dr: totDr, cr: totCr };
}

async function postedLines(dealNumber) {
  const [rows] = await db.query(
    `SELECT le.debit_amount, le.credit_amount, coa.account_code, coa.name AS account_name,
            le.description, le.entry_date
     FROM ledger_entries le
     LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
     WHERE le.deal_number = ?
     ORDER BY le.id`,
    [dealNumber]
  );
  return rows.map((r) =>
    makeLine({
      account_code: r.account_code,
      debit: r.debit_amount,
      credit: r.credit_amount,
      description: r.description,
      entry_date: r.entry_date,
    })
  );
}

function printPosted(label, dealNumber) {
  return postedLines(dealNumber).then((lines) => {
    const totals = printLinesTable(`${label} [POSTED — ${lines.length} line(s)]`, lines);
    return { lines, totals };
  });
}

async function previewGsec(dealNumber) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`GSEC  ${dealNumber}`);
  console.log('='.repeat(72));

  const [rows] = await db.query('SELECT * FROM gsec WHERE deal_number = ? ORDER BY id', [dealNumber]);
  if (!rows.length) {
    console.log('  (not found)');
    return;
  }

  const txType = rows[0].transaction_type;
  const status = [...new Set(rows.map((r) => r.status))].join(', ');
  console.log(`  Type: ${txType} | Status: ${status} | Rows: ${rows.length}`);
  console.log(`  Value date: ${toDateStr(rows[0].value_date)}`);

  await printPosted('Deal-level ledger', dealNumber);

  if (txType === 'Buy') {
    const captured = [];
    const origCompound = ledgerController.postCompoundLedgerEntry;
    ledgerController.postCompoundLedgerEntry = async ({ date, dr_accounts, cr_account, deal_id, description }) => {
      const crTotal = (dr_accounts || []).reduce((s, l) => s + Number(l.amount || 0), 0);
      (dr_accounts || []).forEach((l) => {
        captured.push(
          makeLine({
            account_code: l.account_code,
            debit: l.amount,
            credit: 0,
            description: l.description || description,
            entry_date: date,
          })
        );
      });
      captured.push(
        makeLine({
          account_code: cr_account,
          debit: 0,
          credit: crTotal,
          description,
          entry_date: date,
        })
      );
      return { success: true, deal_id };
    };
    try {
      await postFinalApprovedBuyLedger(rows[0]);
    } finally {
      ledgerController.postCompoundLedgerEntry = origCompound;
    }
    printLinesTable('PREVIEW — Buy entry (would post)', captured);
    return;
  }

  if (txType !== 'Sell') {
    console.log(`  Unsupported transaction type: ${txType}`);
    return;
  }

  const totalFace = rows.reduce((s, r) => s + Number(r.face_value || 0), 0);
  const dealSettlement = Number(rows[0].settlement_amount || 0);
  const dealAccruedRaw = rows.reduce((s, r) => s + Number(r.accrued_interest || 0), 0);
  const distinctAccrued = [...new Set(rows.map((r) => Number(r.accrued_interest || 0)))];
  const perAllocAccruedMode = distinctAccrued.length === rows.length ? 'as-stored' : 'pro-rate-from-total';
  const dealAccruedTotal = perAllocAccruedMode === 'as-stored' ? dealAccruedRaw : (distinctAccrued[0] || 0);

  console.log(`  Total face: ${fmt(totalFace)} | Deal settlement: ${fmt(dealSettlement)}`);
  console.log(`  Accrued mode: ${perAllocAccruedMode}`);

  const allPreviewLines = [];
  let sliceErrors = 0;

  for (const sr of rows) {
    const sellFace = Number(sr.face_value || 0);
    const share = totalFace > 0 ? sellFace / totalFace : 1;
    const allocSettlement = truncate8(dealSettlement * share);
    const allocAccrued =
      perAllocAccruedMode === 'as-stored'
        ? truncate8(Number(sr.accrued_interest || 0))
        : truncate8(dealAccruedTotal * share);

    const sellLike = {
      ...sr,
      face_value: sellFace,
      settlement_amount: allocSettlement,
      accrued_interest: allocAccrued,
    };

    const r = await postFinalApprovedSellLedger(sellLike, { dryRun: true });
    if (!r.success) {
      console.log(`  Slice ${sr.buy_deal_number || sr.id}: FAILED — ${r.error || 'unknown'}`);
      sliceErrors += 1;
      continue;
    }
    allPreviewLines.push(...dryRunToLines(r));
  }

  if (sliceErrors) console.log(`  (${sliceErrors} allocation slice(s) failed preview)`);

  console.log(`\n  ===== CONSOLIDATED PREVIEW (${rows.length} allocation slice(s)) =====`);
  const consolidated = consolidateLines(allPreviewLines);
  const mainLines = consolidated.filter((l) => !/Accrued Interest Reversal/i.test(l.description));
  const revLines = consolidated.filter((l) => /Accrued Interest Reversal/i.test(l.description));

  const main = printLinesTable('Main journal (GSec Sale)', mainLines);
  const rev = printLinesTable('Accrued interest reversal', revLines);
  console.log(`\n  Combined preview balance diff: ${fmt(main.dr + rev.dr - main.cr - rev.cr)}`);
}

async function previewBuySellBuyback(bb) {
  const captured = {};
  const push = (dealId, line) => {
    if (!captured[dealId]) captured[dealId] = [];
    captured[dealId].push(line);
  };

  const origCompound = ledgerController.postCompoundLedgerEntry;
  const origSingle = ledgerController.postLedgerEntry;
  const origMulti = ledgerController.postMultiLineLedgerEntry;

  ledgerController.postCompoundLedgerEntry = async ({ date, dr_accounts, cr_account, deal_id, description }) => {
    const crTotal = (dr_accounts || []).reduce((s, l) => s + Number(l.amount || 0), 0);
    (dr_accounts || []).forEach((l) =>
      push(
        deal_id,
        makeLine({
          account_code: l.account_code,
          debit: l.amount,
          credit: 0,
          description: l.description || description,
          entry_date: date,
        })
      )
    );
    push(
      deal_id,
      makeLine({
        account_code: cr_account,
        debit: 0,
        credit: crTotal,
        description,
        entry_date: date,
      })
    );
    return { success: true };
  };
  ledgerController.postLedgerEntry = async ({ date, dr_account, cr_account, amount, deal_id, description }) => {
    push(deal_id, makeLine({ account_code: dr_account, debit: amount, credit: 0, description, entry_date: date }));
    push(deal_id, makeLine({ account_code: cr_account, debit: 0, credit: amount, description, entry_date: date }));
    return { success: true };
  };
  ledgerController.postMultiLineLedgerEntry = async ({ date, dr_accounts, cr_accounts, deal_id, description }) => {
    (dr_accounts || []).forEach((l) =>
      push(
        deal_id,
        makeLine({
          account_code: l.account_code,
          debit: l.amount,
          credit: 0,
          description: l.description || description,
          entry_date: date,
        })
      )
    );
    (cr_accounts || []).forEach((l) =>
      push(
        deal_id,
        makeLine({
          account_code: l.account_code,
          debit: 0,
          credit: l.amount,
          description: l.description || description,
          entry_date: date,
        })
      )
    );
    return { success: true };
  };

  try {
    await postBuySellBuybackLedger(bb, { dryRun: false, systemDate: '2099-12-31' });
  } finally {
    ledgerController.postCompoundLedgerEntry = origCompound;
    ledgerController.postLedgerEntry = origSingle;
    ledgerController.postMultiLineLedgerEntry = origMulti;
  };

  const printLeg = async (title, dealId) => {
    const previewLines = captured[dealId] || [];
    printLinesTable(`${title} [PREVIEW — ${dealId}]`, previewLines);
    await printPosted(`${title} posted`, dealId);
  };

  if (bb.leg1_transaction_type === 'Buy') {
    await printLeg(`LEG 1 BUY (VD ${toDateStr(bb.leg1_value_date)})`, `${bb.deal_number}/BB-L1/BUY`);
  }
  if (bb.leg2_transaction_type === 'Sell') {
    await printLeg(`LEG 2 SELL (VD ${toDateStr(bb.leg2_value_date)})`, `${bb.deal_number}/BB-L2/SELL`);
  }
}

async function previewSellBuyBuyback(bb) {
  let allocs = bb.sell_deal_allocations;
  if (typeof allocs === 'string') {
    try {
      allocs = JSON.parse(allocs);
    } catch {
      allocs = null;
    }
  }

  const leg1Den =
    Number(bb.leg1_adjusted_face_value != null ? bb.leg1_adjusted_face_value : bb.leg1_face_value) || 0;
  const leg1Settlement = Number(bb.leg1_settlement_amount) || 0;
  const leg1Accrued = Number(bb.leg1_accrued_interest) || 0;

  const slices = [];
  if (Array.isArray(allocs) && allocs.length) {
    for (const a of allocs) {
      const dn = a.deal_number || a.buy_deal_number;
      const amt = Number(a.amountToSell) || 0;
      if (dn && amt > 0) slices.push({ buyDealNumber: dn, faceSlice: amt, synthetic: `${bb.deal_number}/BB-L1/${dn}` });
    }
  } else if (bb.source_buy_deal_number && leg1Den > 0) {
    slices.push({
      buyDealNumber: bb.source_buy_deal_number,
      faceSlice: leg1Den,
      synthetic: `${bb.deal_number}/BB-L1/${bb.source_buy_deal_number}`,
    });
  }

  if (!slices.length) {
    console.log('  No sell allocations — cannot preview leg 1 sell ledger.');
    return;
  }

  const allPreviewLines = [];

  for (const s of slices) {
    console.log(`\n  Slice: buy ${s.buyDealNumber} | face ${fmt(s.faceSlice)} | key ${s.synthetic}`);
    const posted = await postedLines(s.synthetic);
    if (posted.length) {
      printLinesTable('Posted for slice', posted);
      allPreviewLines.push(...posted);
      continue;
    }

    const ratio = leg1Den > 0 ? s.faceSlice / leg1Den : 1;
    const sellLike = {
      deal_number: s.synthetic,
      buy_deal_number: s.buyDealNumber,
      face_value: s.faceSlice,
      settlement_amount: truncate8(leg1Settlement * ratio),
      accrued_interest: truncate8(leg1Accrued * ratio),
      clean_price: bb.leg1_clean_price,
      dirty_price: bb.leg1_dirty_price,
      settlement_mode: bb.leg1_settlement_mode,
      value_date: bb.leg1_value_date,
      trade_date: bb.leg1_trade_date || bb.leg1_value_date,
      transaction_type: 'Sell',
    };

    const r = await postFinalApprovedSellLedger(sellLike, {
      descriptionPrefix: `Buyback ${bb.deal_number} - `,
      dryRun: true,
    });
    if (!r.success) {
      console.log(`    PREVIEW FAILED: ${r.error}`);
      continue;
    }
    const sliceLines = dryRunToLines(r);
    printLinesTable('Preview for slice (would post)', sliceLines);
    allPreviewLines.push(...sliceLines);
  }

  console.log(`\n  ===== CONSOLIDATED LEG 1 SELL PREVIEW (${bb.deal_number}) =====`);
  const consolidated = consolidateLines(allPreviewLines);
  const mainLines = consolidated.filter((l) => !/Accrued Interest Reversal/i.test(l.description));
  const revLines = consolidated.filter((l) => /Accrued Interest Reversal/i.test(l.description));
  printLinesTable('Main journal (consolidated)', mainLines);
  printLinesTable('Accrued interest reversal (consolidated)', revLines);
}

async function previewBuyback(dealNumber) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`BUYBACK  ${dealNumber}`);
  console.log('='.repeat(72));

  const [rows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ? LIMIT 1', [dealNumber]);
  if (!rows.length) {
    console.log('  (not found)');
    return;
  }
  const bb = rows[0];
  const structure = `${bb.leg1_transaction_type}/${bb.leg2_transaction_type}`;
  console.log(`  Status: ${bb.deal_status} | Structure: ${structure}`);
  console.log(`  Leg1 VD: ${toDateStr(bb.leg1_value_date)} | Leg2 VD: ${toDateStr(bb.leg2_value_date)}`);
  console.log(`  Leg1 face: ${fmt(bb.leg1_face_value)} | Leg2 face: ${fmt(bb.leg2_face_value)}`);

  if (bb.leg1_transaction_type === 'Buy' && bb.leg2_transaction_type === 'Sell') {
    await previewBuySellBuyback(bb);
    return;
  }

  if (bb.leg1_transaction_type === 'Sell' && bb.leg2_transaction_type === 'Buy') {
    console.log('  Sell/Buy structure — previewing Leg 1 (Sell) ledger only.');
    await previewSellBuyBuyback(bb);
    return;
  }

  console.log(`  Unsupported structure: ${structure}`);
}

async function main() {
  await loadAccountNames();
  console.log('LEDGER ENTRY PREVIEW (read-only, no DB writes)');
  console.log(`Deals: ${DEALS.join(', ')}`);

  for (const deal of DEALS) {
    try {
      if (deal.startsWith('BB')) {
        await previewBuyback(deal);
      } else {
        await previewGsec(deal);
      }
    } catch (e) {
      console.error(`\nERROR previewing ${deal}:`, e.message);
    }
  }

  console.log('\n--- End of preview ---');
  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
