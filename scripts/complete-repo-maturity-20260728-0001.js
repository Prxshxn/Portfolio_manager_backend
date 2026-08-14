#!/usr/bin/env node
'use strict';
/**
 * Complete leftover Repo maturity for 20260728/REPO/0001.
 *
 * EOD matures repos only when maturity_date = system_day + 1. After the
 * mistaken 30-Jul EOD was reversed (and this deal un-matured), re-running
 * EOD on 30-Jul correctly matured 31-Jul deals but never re-picked this
 * deal (maturity = 30-Jul). Post the standard 3-leg Repo maturity as of
 * 2026-07-30 and mark the deal matured.
 *
 * Usage: node scripts/complete-repo-maturity-20260728-0001.js [--execute]
 */
require('dotenv').config();
const db = require('../config/database');
const accountMapping = require('../services/accountMappingService');
const { postLedgerEntry } = require('../controllers/ledgerController');

const EXECUTE = process.argv.includes('--execute');
const DEAL_NUMBER = '20260728/REPO/0001';
const MATURITY_DATE = '2026-07-30';

function isOk(r) {
  return r && (r.success === true || r.ok === true || (!r.error && r.success !== false));
}

(async () => {
  const [rows] = await db.query(
    `SELECT id, deal_number, deal_type, principal_amount, interest_amount, settlement_mode,
            maturity_date, status, matured, approval_status
     FROM repo_deals WHERE deal_number = ?`,
    [DEAL_NUMBER]
  );
  if (!rows.length) throw new Error('Deal not found');
  const deal = rows[0];
  console.table([deal]);

  if (Number(deal.matured) === 1) {
    console.log('Already matured — nothing to do.');
    process.exit(0);
  }

  const [existing] = await db.query(
    `SELECT LEFT(description, 60) AS descr, COUNT(*) AS c
     FROM ledger_entries
     WHERE deal_number = ?
       AND (description LIKE 'Repo Maturity - Deal %'
            OR description LIKE 'Repo Interest Accrual Reversal - Deal %')
     GROUP BY LEFT(description, 60)`,
    [DEAL_NUMBER]
  );
  console.log('Existing maturity rows:');
  console.table(existing);
  if (existing.length) {
    console.error('Maturity rows already exist — aborting to avoid double-post.');
    process.exit(1);
  }

  const [sa] = await db.query(
    'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
    [deal.settlement_mode]
  );
  const bankAccount = sa[0] && sa[0].ledger_account_code;
  if (!bankAccount) throw new Error('No settlement bank account');

  const principalAmount = Number(deal.principal_amount) || 0;
  const interestAmount = Number(deal.interest_amount) || 0;
  const liabilityAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY);
  const interestPayable = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_PAYABLE);
  const accrualInterestExpense = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_EXPENSE);
  const maturityInterestExpense = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_MATURITY_INTEREST_EXPENSE);

  const legs = [
    {
      label: 'Accrual reversal',
      date: MATURITY_DATE,
      dr: interestPayable,
      cr: accrualInterestExpense,
      amount: interestAmount,
      description: `Repo Interest Accrual Reversal - Deal ${DEAL_NUMBER}`
    },
    {
      label: 'Principal settle',
      date: MATURITY_DATE,
      dr: liabilityAccount,
      cr: bankAccount,
      amount: principalAmount,
      description: `Repo Maturity - Deal ${DEAL_NUMBER}`
    },
    {
      label: 'Interest expense',
      date: MATURITY_DATE,
      dr: maturityInterestExpense,
      cr: bankAccount,
      amount: interestAmount,
      description: `Repo Maturity - Deal ${DEAL_NUMBER}`
    }
  ];
  console.log('Will post:');
  console.table(legs.map((l) => ({
    label: l.label, date: l.date, amount: l.amount, dr: l.dr, cr: l.cr, description: l.description
  })));

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  for (const leg of legs) {
    if (!(leg.amount > 0)) continue;
    const lr = await postLedgerEntry({
      date: leg.date,
      dr_account: leg.dr,
      cr_account: leg.cr,
      amount: leg.amount,
      deal_id: DEAL_NUMBER,
      description: leg.description
    });
    if (!isOk(lr)) {
      console.error('Post failed:', leg.label, lr && lr.error);
      process.exit(1);
    }
    console.log('Posted:', leg.label);
  }

  await db.query("UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?", [deal.id]);
  console.log(`Marked ${DEAL_NUMBER} matured.`);

  const [verify] = await db.query(
    `SELECT LEFT(description, 60) AS descr, COUNT(*) AS c,
            SUM(debit_amount) AS dr, SUM(credit_amount) AS cr
     FROM ledger_entries
     WHERE deal_number = ?
       AND DATE(entry_date) = ?
       AND (description LIKE 'Repo Maturity%' OR description LIKE 'Repo Interest Accrual Reversal%')
     GROUP BY LEFT(description, 60)`,
    [DEAL_NUMBER, MATURITY_DATE]
  );
  console.table(verify);
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
