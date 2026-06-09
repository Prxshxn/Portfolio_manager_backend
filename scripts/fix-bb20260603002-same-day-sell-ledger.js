/**
 * Correct same-day buyback sell ledger for BB20260603002/BB-L1/20260603/GSEC/0001:
 * - Remove misclassified 574 (coupon income) and 570/568 (accrual reversal)
 * - Add 458 (accrued coupon paid at purchase unwind)
 *
 * Run: node scripts/fix-bb20260603002-same-day-sell-ledger.js
 */
const db = require('../config/database');

const DEAL = 'BB20260603002/BB-L1/20260603/GSEC/0001';
const ACCRUED_AT_PURCHASE_CODE = '131-101-350-128-44'; // account id 458
const COUPON_INCOME_CODE = '467-101-190-476-44';       // 574
const ACCRUAL_INCOME_CODE = '467-101-190-470-44';    // 570
const ACCRUAL_RECEIVABLE_CODE = '131-101-290-218-44'; // 568
const FINAL_DESC =
  'Buyback BB20260603002 - GSec Sale - Final Approval - BB20260603002/BB-L1/20260603/GSEC/0001';

async function acctId(code) {
  const [r] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]);
  if (!r.length) throw new Error(`Missing account ${code}`);
  return r[0].id;
}

async function main() {
  const pool = require('../config/database').pool;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const acct458 = await acctId(ACCRUED_AT_PURCHASE_CODE);
    const acct574 = await acctId(COUPON_INCOME_CODE);
    const acct570 = await acctId(ACCRUAL_INCOME_CODE);
    const acct568 = await acctId(ACCRUAL_RECEIVABLE_CODE);

    const [existing458] = await conn.query(
      `SELECT id FROM ledger_entries WHERE deal_number = ? AND account_id = ? AND description = ?`,
      [DEAL, acct458, FINAL_DESC]
    );
    if (existing458.length) {
      console.log('458 line already present; skipping insert.');
    }

    const [wrong] = await conn.query(
      `SELECT id, account_id, debit_amount, credit_amount, description
       FROM ledger_entries WHERE deal_number = ? AND account_id IN (?,?,?)`,
      [DEAL, acct574, acct570, acct568]
    );

    if (!wrong.length && existing458.length) {
      console.log('Already corrected.');
      await conn.rollback();
      process.exit(0);
    }

    const amountRow = wrong.find((r) => Number(r.credit_amount) > 0 && r.account_id === acct574)
      || wrong.find((r) => Number(r.debit_amount) > 0 && r.account_id === acct570);
    const amount = amountRow
      ? Number(amountRow.credit_amount || amountRow.debit_amount)
      : 3795072.42;

    const [sample] = await conn.query(
      `SELECT entry_date FROM ledger_entries WHERE deal_number = ? ORDER BY id LIMIT 1`,
      [DEAL]
    );
    const entryDate = sample.length
      ? new Date(sample[0].entry_date).toISOString().slice(0, 10)
      : '2026-06-03';

    if (wrong.length) {
      const ids = wrong.map((r) => r.id);
      await conn.query(`DELETE FROM ledger_entries WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      console.log('Deleted misclassified lines:', ids);
    }

    if (!existing458.length && amount > 0) {
      await conn.query(
        `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
         VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
        [entryDate, acct458, amount, DEAL, FINAL_DESC]
      );
      console.log(`Inserted 458 CR ${amount} for ${DEAL}`);
    }

    await conn.commit();

    const [check] = await conn.query(
      `SELECT le.id, le.entry_date, le.debit_amount, le.credit_amount, coa.account_code, coa.name, le.description
       FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
       WHERE le.deal_number = ? ORDER BY le.id`,
      [DEAL]
    );
    console.log('\n=== Ledger after fix ===');
    check.forEach((e) =>
      console.log(
        `#${e.id} [${e.account_code}] DR=${e.debit_amount} CR=${e.credit_amount} :: ${e.description}`
      )
    );
    process.exit(0);
  } catch (e) {
    await conn.rollback();
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
}

main();
