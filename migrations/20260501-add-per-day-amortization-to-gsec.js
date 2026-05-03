/**
 * Add gsec.per_day_amortization for daily premium/discount amortization amount (EOD).
 *
 * Run: node migrations/20260501-add-per-day-amortization-to-gsec.js
 */

const db = require('../config/database');

async function run() {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'gsec'
       AND COLUMN_NAME = 'per_day_amortization'`
  );
  if (rows[0] && Number(rows[0].c) > 0) {
    console.log('Column per_day_amortization already exists, skipping.');
    process.exit(0);
    return;
  }

  await db.query(
    `ALTER TABLE gsec
     ADD COLUMN per_day_amortization DECIMAL(20,8) NULL
     COMMENT 'Daily premium/discount amortization (straight-line to maturity)'`
  );
  console.log('Added column per_day_amortization');
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run };
