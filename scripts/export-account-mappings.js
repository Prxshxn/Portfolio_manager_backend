/**
 * Export all active account_mappings (joined with their chart_of_accounts and
 * account_types rows) so they can be replicated into another environment of
 * this project via migrations/20260610-replicate-account-mappings.js.
 *
 * Buyback-only chart codes are excluded (they aren't referenced by any
 * account_mappings row anyway, but are excluded explicitly for clarity):
 *   131-101-350-204-44 - Treasury Bonds - Trading A/c (Buyback)
 *   131-101-350-208-44 - Accrued Coupon Interest Paid at Purchase - TBond Trading (Buyback)
 *
 * Run on the SOURCE database:
 *   node scripts/export-account-mappings.js [output-path]
 *
 * Default output: migrations/data/account-mappings-export.json
 * Copy that file to the target environment before running the import migration.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const EXCLUDED_ACCOUNT_CODES = [
  '131-101-350-204-44', // Treasury Bonds - Trading A/c (Buyback)
  '131-101-350-208-44'  // Accrued Coupon Interest Paid at Purchase - TBond Trading (Buyback)
];

async function run() {
  const outputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'migrations', 'data', 'account-mappings-export.json');

  const [rows] = await db.query(
    `SELECT
       am.mapping_key,
       am.account_code,
       am.description AS mapping_description,
       coa.name AS account_name,
       coa.description AS account_description,
       parent.account_code AS parent_account_code,
       at.name AS account_type_name,
       at.category AS account_type_category
     FROM account_mappings am
     JOIN chart_of_accounts coa ON am.account_code = coa.account_code
     JOIN account_types at ON coa.account_type_id = at.id
     LEFT JOIN chart_of_accounts parent ON coa.parent_account_id = parent.id
     WHERE am.is_active = TRUE
       AND am.account_code NOT IN (?)
     ORDER BY am.mapping_key`,
    [EXCLUDED_ACCOUNT_CODES]
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));
  console.log(`Exported ${rows.length} account mappings to ${outputPath}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
