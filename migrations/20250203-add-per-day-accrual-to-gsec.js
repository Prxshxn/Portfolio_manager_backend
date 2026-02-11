const db = require('../config/db');
const mysql = require('mysql2/promise');

async function addPerDayAccrualColumn() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'itms'
    });

    // Check if column exists
    const [rows] = await connection.query(
      `SELECT COUNT(*) as count 
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = ? 
       AND TABLE_NAME = 'gsec' 
       AND COLUMN_NAME = 'per_day_accrual'`,
      [process.env.DB_NAME || 'itms']
    );

    if (rows[0].count > 0) {
      console.log('Column per_day_accrual already exists, skipping...');
      return;
    }

    // Add the column
    await connection.query(
      `ALTER TABLE gsec 
       ADD COLUMN per_day_accrual DECIMAL(20,8) NULL 
       COMMENT 'Daily accrual amount: couponInterest / numberOfDaysForCouponPeriod'`
    );
    console.log('✓ Added column: per_day_accrual');

    console.log('\n✓ Migration completed successfully!');
  } catch (error) {
    console.error('Migration error:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the migration
if (require.main === module) {
  addPerDayAccrualColumn()
    .then(() => {
      console.log('Migration script finished.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addPerDayAccrualColumn;
