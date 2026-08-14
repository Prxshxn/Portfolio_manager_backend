/**
 * Replace incorrect Reverse Repo maturity (ids 26239/26240, dated 2026-06-01,
 * full maturity amount) with standard Repo 3-leg maturity dated 2026-06-02
 * for deal 20260601/RVREPO/0001.
 *
 *   node scripts/backfill-rvrepo-0001-as-repo-maturity.js
 *   node scripts/backfill-rvrepo-0001-as-repo-maturity.js --execute
 */
require('dotenv').config();
const db = require('../config/database');
const accountMapping = require('../services/accountMappingService');
const { postLedgerEntry } = require('../controllers/ledgerController');

const EXECUTE = process.argv.includes('--execute');
const DEAL_NUMBER = '20260601/RVREPO/0001';
const MATURITY_DATE = '2026-06-02';
const OLD_ENTRY_IDS = [26239, 26240];

function isOk(r) {
  return r && (r.success === true || r.ok === true || (!r.error && r.success !== false));
}

(async () => {
  const [rows] = await db.query(
    `SELECT id, deal_number, deal_type, principal_amount, interest_amount, settlement_mode,
            maturity_date, status, matured
     FROM repo_deals WHERE deal_number = ?`,
    [DEAL_NUMBER]
  );
  if (!rows.length) throw new Error('Deal not found');
  const deal = rows[0];
  const principal = Number(deal.principal_amount) || 0;
  const interest = Number(deal.interest_amount) || 0;

  const [oldRows] = await db.query(
    `SELECT id, entry_date, account_id, debit_amount, credit_amount, description
     FROM ledger_entries WHERE id IN (?, ?)`,
    OLD_ENTRY_IDS
  );
  console.log('Old maturity rows to remove:');
  console.table(oldRows);
  if (oldRows.length !== 2) {
    throw new Error(`Expected 2 old rows (${OLD_ENTRY_IDS.join(',')}), found ${oldRows.length}`);
  }

  const [sa] = await db.query(
    'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
    [deal.settlement_mode]
  );
  const bankAccount = sa[0]?.ledger_account_code;
  if (!bankAccount) throw new Error('No settlement bank account');

  const liability = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY);
  const interestPayable = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_PAYABLE);
  const accrualExpense = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_EXPENSE);
  const maturityExpense = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_MATURITY_INTEREST_EXPENSE);

  const legs = [
    {
      label: 'Accrual reversal',
      date: MATURITY_DATE,
      dr: interestPayable,
      cr: accrualExpense,
      amount: interest,
      description: `Repo Interest Accrual Reversal - Deal ${DEAL_NUMBER}`
    },
    {
      label: 'Principal settle',
      date: MATURITY_DATE,
      dr: liability,
      cr: bankAccount,
      amount: principal,
      description: `Repo Maturity - Deal ${DEAL_NUMBER}`
    },
    {
      label: 'Interest settle',
      date: MATURITY_DATE,
      dr: maturityExpense,
      cr: bankAccount,
      amount: interest,
      description: `Repo Maturity - Deal ${DEAL_NUMBER}`
    }
  ];

  console.log('\nWill post (dated', MATURITY_DATE + '):');
  console.table(legs.map((l) => ({
    label: l.label,
    date: l.date,
    amount: Number(l.amount).toFixed(2),
    dr: l.dr,
    cr: l.cr,
    description: l.description
  })));

  // Guard: don't double-post if already present for maturity date
  const [already] = await db.query(
    `SELECT id, description, debit_amount, credit_amount
     FROM ledger_entries
     WHERE deal_number = ?
       AND DATE(entry_date) = DATE(?)
       AND (description LIKE 'Repo Maturity - Deal %'
            OR description LIKE 'Repo Interest Accrual Reversal - Deal %')`,
    [DEAL_NUMBER, MATURITY_DATE]
  );
  if (already.length) {
    console.log('\nExisting 2026-06-02 repo maturity rows:');
    console.table(already);
    throw new Error('Repo maturity rows already exist for 2026-06-02 — aborting');
  }

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to delete old rows and post new legs.');
    process.exit(0);
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [del] = await conn.query(
      `DELETE FROM ledger_entries WHERE id IN (?, ?)`,
      OLD_ENTRY_IDS
    );
    console.log(`Deleted old maturity rows: ${del.affectedRows}`);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
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
    console.log(`Posted ${leg.label}: ${Number(leg.amount).toFixed(2)}`);
  }

  await db.query(
    `UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?`,
    [deal.id]
  );

  const [verify] = await db.query(
    `SELECT id, DATE(entry_date) AS d, account_id, debit_amount, credit_amount, description
     FROM ledger_entries
     WHERE deal_number = ?
       AND (description LIKE '%Maturity%' OR description LIKE '%Accrual Reversal%')
     ORDER BY id`,
    [DEAL_NUMBER]
  );
  console.log('\nMaturity-related ledger now:');
  console.table(verify);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
