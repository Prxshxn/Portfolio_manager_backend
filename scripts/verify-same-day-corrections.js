#!/usr/bin/env node
/* eslint-disable no-console */
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

(async () => {
  let ok = 0;
  let badAmort = 0;
  for (const dn of ALL_18) {
    const [rows] = await db.query(
      `SELECT coa.account_code, le.debit_amount, le.credit_amount, le.created_at
       FROM ledger_entries le
       LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
       WHERE le.deal_number = ?
       ORDER BY le.id`,
      [dn]
    );
    if (!rows.length) {
      console.log('MISSING:', dn);
      continue;
    }
    let amort = 0;
    rows.forEach((r) => {
      if ((r.account_code || '').includes('416')) {
        amort += Number(r.debit_amount || 0) - Number(r.credit_amount || 0);
      }
    });
    const latest = rows[rows.length - 1].created_at;
    const status = Math.abs(amort) > 0.01 ? 'STILL HAS AMORT' : 'OK';
    if (status === 'OK') ok += 1;
    else badAmort += 1;
    console.log(`${status} | ${dn} | ${rows.length} lines | amort=${amort.toFixed(2)} | latest=${String(latest).slice(0, 19)}`);
  }
  console.log(`\nSummary: ${ok}/18 corrected OK, ${badAmort} still have amort lines`);
  if (typeof db.end === 'function') await db.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
