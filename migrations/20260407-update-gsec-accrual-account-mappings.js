/**
 * Point GSEC daily accrual postings to dedicated GSec chart accounts:
 *   DR GSEC_ACCRUAL_ASSET  -> 131-101-290-218-44 GSec Accrued Interest Receivable
 *   CR GSEC_ACCRUAL_INCOME -> 467-101-190-470-44 GSec Interest Income (Accrued)
 *
 * Run: node migrations/20260407-update-gsec-accrual-account-mappings.js
 * Requires rows in chart_of_accounts for both account_code values.
 */

const db = require('../config/database');

const GSEC_ASSET_CODE = '131-101-290-218-44';
const GSEC_INCOME_CODE = '467-101-190-470-44';

async function run() {
  const [assetRows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [GSEC_ASSET_CODE]
  );
  const [incomeRows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [GSEC_INCOME_CODE]
  );
  if (!assetRows.length || !incomeRows.length) {
    console.error(
      'Missing chart_of_accounts rows. Ensure both codes exist:',
      GSEC_ASSET_CODE,
      GSEC_INCOME_CODE
    );
    process.exit(1);
  }

  await db.query(
    `UPDATE account_mappings
     SET account_code = ?, description = ?, updated_at = NOW()
     WHERE mapping_key = 'GSEC_ACCRUAL_ASSET' AND is_active = TRUE`,
    [GSEC_ASSET_CODE, 'GSec Accrued Interest Receivable']
  );
  await db.query(
    `UPDATE account_mappings
     SET account_code = ?, description = ?, updated_at = NOW()
     WHERE mapping_key = 'GSEC_ACCRUAL_INCOME' AND is_active = TRUE`,
    [GSEC_INCOME_CODE, 'GSec Interest Income (Accrued)']
  );

  const [check] = await db.query(
    `SELECT mapping_key, account_code, description FROM account_mappings
     WHERE mapping_key IN ('GSEC_ACCRUAL_ASSET', 'GSEC_ACCRUAL_INCOME')`
  );
  console.log('GSEC accrual mappings updated:', check);
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run };
