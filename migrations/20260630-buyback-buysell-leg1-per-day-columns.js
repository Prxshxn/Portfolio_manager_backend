'use strict';

/**
 * Store computed daily accrual/amortization for Buy/Sell buyback leg1 (buy leg).
 */

const db = require('../config/database');

async function columnExists(column) {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'buyback_deals'
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [column]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(column, definition) {
  if (await columnExists(column)) return;
  await db.query(`ALTER TABLE buyback_deals ADD COLUMN ${column} ${definition}`);
  console.log(`Added buyback_deals.${column}`);
}

async function up() {
  await addColumnIfMissing('leg1_per_day_accrual', 'DECIMAL(20,8) NULL');
  await addColumnIfMissing('leg1_per_day_amortization', 'DECIMAL(20,8) NULL');
  await addColumnIfMissing('leg1_number_of_days_for_coupon_period', 'INT NULL');
}

if (require.main === module) {
  up()
    .then(() => {
      console.log('Migration complete: buyback Buy/Sell leg1 per-day columns');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { up };
