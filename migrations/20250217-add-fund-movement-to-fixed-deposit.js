const db = require('../config/db');

async function addFundMovementToFixedDeposit() {
  try {
    const tableName = 'fixed_deposit_requests';
    const [columns] = await db.query(`DESCRIBE ${tableName}`);
    const columnNames = columns.map(col => col.Field);

    const toAdd = [
      { name: 'fund_movement', sql: 'VARCHAR(10) NULL DEFAULT NULL' },
      { name: 'fund_movement_type', sql: 'VARCHAR(20) NULL DEFAULT NULL' },
      { name: 'part_amount_cash', sql: 'DECIMAL(20,2) NULL DEFAULT NULL' },
      { name: 'part_amount_from_sources', sql: 'DECIMAL(20,2) NULL DEFAULT NULL' },
      { name: 'settlement_account_code', sql: 'VARCHAR(50) NULL DEFAULT NULL' },
      { name: 'fund_source_deal_ids', sql: 'VARCHAR(500) NULL DEFAULT NULL' }
    ];

    for (const col of toAdd) {
      if (!columnNames.includes(col.name)) {
        await db.query(`
          ALTER TABLE ${tableName}
          ADD COLUMN ${col.name} ${col.sql}
        `);
        console.log(`  Added ${col.name} to ${tableName}`);
      } else {
        console.log(`  ${col.name} already exists in ${tableName}`);
      }
    }

    console.log('Fund movement migration completed successfully');
  } catch (error) {
    console.error('Fund movement migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  addFundMovementToFixedDeposit()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = addFundMovementToFixedDeposit;
