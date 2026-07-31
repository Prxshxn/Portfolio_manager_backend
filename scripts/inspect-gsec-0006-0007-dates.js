#!/usr/bin/env node
'use strict';
const db = require('../config/database');

const DEALS = ['20260625/GSEC/0006', '20260625/GSEC/0007'];

(async () => {
  for (const dn of DEALS) {
    const [g] = await db.query(
      "SELECT id, deal_number, transaction_type, value_date, trade_date, settlement_amount, created_at FROM gsec WHERE deal_number = ?",
      [dn]
    );
    console.log('\n=== GSEC', dn, '===');
    for (const r of g) {
      console.log(
        ' gsec id', r.id,
        '| type', r.transaction_type,
        '| value_date', r.value_date,
        '| trade_date', r.trade_date
      );
    }
    const [le] = await db.query(
      `SELECT le.id, le.account_id, coa.account_code, le.entry_date,
              le.debit_amount, le.credit_amount, le.description, le.created_at
       FROM ledger_entries le
       LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
       WHERE le.deal_number = ?
       ORDER BY le.id`,
      [dn]
    );
    console.log(' ledger lines:');
    for (const r of le) {
      console.log(
        '  id', r.id,
        '| acct', r.account_id, r.account_code || '',
        '| entry_date', r.entry_date,
        '| DR', Number(r.debit_amount),
        '| CR', Number(r.credit_amount),
        '| created', r.created_at
      );
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
