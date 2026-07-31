#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const ALL_18 = [
  '20260526/GSEC/0003', '20260601/GSEC/0009',
  'BB20260506001/BB-L1/20260506/GSEC/0003', 'BB20260506002/BB-L1/20260506/GSEC/0002',
  'BB20260507001/BB-L1/20260507/GSEC/0003', 'BB20260507002/BB-L1/20260507/GSEC/0002',
  'BB20260511002/BB-L1/20260511/GSEC/0002', 'BB20260513002/BB-L1/20260513/GSEC/0001',
  'BB20260514001/BB-L1/20260514/GSEC/0001', 'BB20260515001/BB-L1/20260515/GSEC/0001',
  'BB20260518001/BB-L1/20260518/GSEC/0001', 'BB20260520001/BB-L1/20260520/GSEC/0003',
  'BB20260525004/BB-L1/20260525/GSEC/0003', 'BB20260527001/BB-L1/20260526/GSEC/0001',
  'BB20260527002/BB-L1/20260527/GSEC/0002', 'BB20260527003/BB-L1/20260527/GSEC/0003',
  'BB20260529001/BB-L1/20260529/GSEC/0002', 'BB20260603002/BB-L1/20260603/GSEC/0001',
];

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
}

(async () => {
  const buf = [];
  buf.push('CORRECTED LEDGER ENTRIES — ALL 18 SAME-DAY SELL DEALS');
  buf.push(`Generated: ${new Date().toISOString()}`);
  buf.push('Source: live ledger_entries after retro-correct-same-day-sell-ledgers.js --execute\n');

  for (let i = 0; i < ALL_18.length; i += 1) {
    const dn = ALL_18[i];
    const [rows] = await db.query(
      `SELECT le.id, le.entry_date, le.debit_amount, le.credit_amount, le.description,
              coa.account_code, coa.name AS account_name
       FROM ledger_entries le
       LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
       WHERE le.deal_number = ?
       ORDER BY le.id`,
      [dn]
    );

    buf.push('='.repeat(100));
    buf.push(`${i + 1}. ${dn}  (${rows.length} line(s))`);
    buf.push('='.repeat(100));

    if (!rows.length) {
      buf.push('  (no ledger entries)\n');
      continue;
    }

    buf.push(
      '  ' +
        'Date'.padEnd(12) +
        'Account Code'.padEnd(22) +
        'Account Name'.padEnd(52) +
        'Debit'.padStart(16) +
        'Credit'.padStart(16) +
        '  Description'
    );
    buf.push('  ' + '-'.repeat(160));

    let totDr = 0;
    let totCr = 0;
    for (const r of rows) {
      const dr = Number(r.debit_amount || 0);
      const cr = Number(r.credit_amount || 0);
      totDr += dr;
      totCr += cr;
      buf.push(
        '  ' +
          toDate(r.entry_date).padEnd(12) +
          String(r.account_code || '').padEnd(22) +
          String(r.account_name || '').padEnd(52) +
          (dr ? fmt(dr) : '').padStart(16) +
          (cr ? fmt(cr) : '').padStart(16) +
          '  ' +
          (r.description || '')
      );
    }
    buf.push('  ' + ''.padEnd(86) + fmt(totDr).padStart(16) + fmt(totCr).padStart(16));
    buf.push('');
  }

  const out = path.join(__dirname, '..', 'docs', 'corrected-deals-ledger-entries.txt');
  const text = buf.join('\n');
  fs.writeFileSync(out, text, 'utf8');
  console.log(text);
  console.log(`\nWritten: ${out}`);
  if (typeof db.end === 'function') await db.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
