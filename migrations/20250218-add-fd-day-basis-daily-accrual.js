const db = require('../config/db');

async function addFdDayBasisDailyAccrual() {
  try {
    const tableName = 'fixed_deposit_requests';
    const [columns] = await db.query(`DESCRIBE ${tableName}`);
    const columnNames = columns.map(col => col.Field);

    const toAdd = [
      { name: 'day_basis', sql: 'INT NULL DEFAULT 365' },
      { name: 'daily_accrual', sql: 'DECIMAL(20,8) NULL DEFAULT NULL COMMENT \'Daily accrual: (requested_amount * target_yield / 100) / day_basis\'' }
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

    console.log('FD day_basis and daily_accrual migration completed successfully');
  } catch (error) {
    console.error('FD day_basis and daily_accrual migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  addFdDayBasisDailyAccrual()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = addFdDayBasisDailyAccrual;
