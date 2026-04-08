/**
 * Repoint ledger_entries from pseudo chart rows (e.g. GSEC_ACCRUAL_INCOME_, GSEC_ACCRUAL_ASSET_C)
 * to the real chart_of_accounts rows given by account_mappings.account_code.
 *
 * Usage (from Portfolio_manager_backend):
 *   node scripts/backfill-gsec-accrual-ledger-account-ids.js           # dry run, preview
 *   node scripts/backfill-gsec-accrual-ledger-account-ids.js --execute # apply UPDATE
 *
 * Requires: account_mappings rows for GSEC_ACCRUAL_INCOME / GSEC_ACCRUAL_ASSET with correct
 * account_code, and matching active rows in chart_of_accounts.
 */

const db = require('../config/database');

/** Same matching rule as routes/accounting.js LEDGER_ACCOUNT_MAPPING_JOIN + GSEC accrual keys only. */
const MAPPING_MATCH = `
  am.is_active = TRUE
  AND am.mapping_key IN ('GSEC_ACCRUAL_INCOME', 'GSEC_ACCRUAL_ASSET')
  AND (
    am.mapping_key = coa.account_code
    OR am.mapping_key = TRIM(TRAILING '_' FROM coa.account_code)
    OR coa.account_code REGEXP CONCAT('^', am.mapping_key, '_.*$')
  )
`;

async function main() {
  const execute = process.argv.includes('--execute');

  const previewSql = `
    SELECT le.id, le.entry_date, le.deal_number,
           coa.account_code AS from_code, coa.name AS from_name,
           coa2.id AS target_account_id, coa2.account_code AS target_code, coa2.name AS target_name,
           am.mapping_key
    FROM ledger_entries le
    INNER JOIN chart_of_accounts coa ON le.account_id = coa.id
    INNER JOIN account_mappings am ON ${MAPPING_MATCH}
    INNER JOIN chart_of_accounts coa2 ON coa2.account_code = am.account_code AND coa2.is_active = TRUE
    WHERE le.account_id <> coa2.id
    ORDER BY le.id
  `;

  const [rows] = await db.query(previewSql);
  console.log(`Ledger lines to repoint: ${rows.length}`);
  const previewN = Math.min(25, rows.length);
  for (let i = 0; i < previewN; i += 1) {
    const r = rows[i];
    console.log(
      `  id=${r.id} deal=${r.deal_number} ${r.from_code} -> ${r.target_code} (${r.mapping_key})`
    );
  }
  if (rows.length > previewN) {
    console.log(`  ... and ${rows.length - previewN} more`);
  }

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to update ledger_entries.account_id.');
    process.exit(0);
  }

  if (rows.length === 0) {
    console.log('Nothing to update.');
    process.exit(0);
  }

  const updateSql = `
    UPDATE ledger_entries le
    INNER JOIN chart_of_accounts coa ON le.account_id = coa.id
    INNER JOIN account_mappings am ON ${MAPPING_MATCH}
    INNER JOIN chart_of_accounts coa2 ON coa2.account_code = am.account_code AND coa2.is_active = TRUE
    SET le.account_id = coa2.id
    WHERE le.account_id <> coa2.id
  `;

  const [result] = await db.query(updateSql);
  const affected = result.affectedRows ?? result.changedRows ?? 0;
  console.log(`\nUpdated rows (affected): ${affected}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
