/**
 * GSec brokerage ledger mappings (final-approval DR Paid / CR Payable).
 * Mapping-only: upserts account_mappings. Does not insert chart_of_accounts
 * or ledger rows. Fails if either chart code is missing.
 *
 * Run: node migrations/20260901-add-gsec-brokerage-ledger-mappings.js
 */

const db = require('../config/database');

const PAIRS = [
  [
    'GSEC_BROKERAGE_PAID',
    '651-101-120-530-44',
    'Brokerage Paid (GSec final-approval expense DR when brokerage > 0)'
  ],
  [
    'GSEC_BROKERAGE_PAYABLE',
    '249-101-270-266-44',
    'Brokerage Payable (GSec final-approval liability CR when brokerage > 0)'
  ]
];

async function run() {
  for (const [key, code, description] of PAIRS) {
    const [rows] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
      [code]
    );
    if (!rows.length) {
      const msg = `Missing chart_of_accounts row for code: ${code} (mapping ${key})`;
      console.error(msg);
      throw new Error(msg);
    }
    await db.query(
      `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, TRUE, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         account_code = VALUES(account_code),
         description = VALUES(description),
         is_active = VALUES(is_active),
         updated_at = NOW()`,
      [key, code, description]
    );
  }
  const keys = PAIRS.map((p) => p[0]);
  const [check] = await db.query(
    `SELECT mapping_key, account_code, is_active FROM account_mappings WHERE mapping_key IN (?)`,
    [keys]
  );
  console.log('GSec brokerage ledger mappings:', check);
}

async function up() {
  await run();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { run, up };
