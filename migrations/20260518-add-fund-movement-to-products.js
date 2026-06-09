const db = require('../config/db');

async function addFundMovementColumns() {
  const targets = [
    { table: 'gsec', column: 'fund_movement', sql: "VARCHAR(10) NULL DEFAULT 'no'" },
    { table: 'buyback_deals', column: 'fund_movement', sql: "VARCHAR(10) NULL DEFAULT 'no'" },
    { table: 'repo_deals', column: 'fund_movement', sql: "VARCHAR(10) NULL DEFAULT 'no'" }
  ];

  for (const target of targets) {
    const [rows] = await db.query(
      `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [target.table, target.column]
    );

    if (rows.length > 0) {
      console.log(`${target.table}.${target.column} already exists`);
      continue;
    }

    await db.query(`ALTER TABLE ${target.table} ADD COLUMN ${target.column} ${target.sql}`);
    console.log(`Added ${target.table}.${target.column}`);
  }
}

if (require.main === module) {
  addFundMovementColumns()
    .then(() => {
      console.log('Fund movement migration complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fund movement migration failed:', err);
      process.exit(1);
    });
}

module.exports = addFundMovementColumns;
