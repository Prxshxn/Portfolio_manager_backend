const db = require('../config/db');

async function addFundCentreToHolidayCalendar() {
  try {
    // Check if fund_centre_id column exists
    const [columns] = await db.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'holiday_calendar' 
      AND COLUMN_NAME = 'fund_centre_id'
    `);
    
    if (columns.length === 0) {
      // Add fund_centre_id column
      await db.query(`
        ALTER TABLE holiday_calendar 
        ADD COLUMN fund_centre_id INT NULL AFTER reason
      `);
      console.log('✓ Added fund_centre_id column to holiday_calendar');
    } else {
      console.log('⏭ fund_centre_id column already exists in holiday_calendar');
    }
    
    // Check and add index
    const [indexes] = await db.query(`
      SELECT INDEX_NAME 
      FROM INFORMATION_SCHEMA.STATISTICS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'holiday_calendar' 
      AND INDEX_NAME = 'idx_fund_centre_id'
    `);
    
    if (indexes.length === 0) {
      await db.query(`
        CREATE INDEX idx_fund_centre_id ON holiday_calendar(fund_centre_id)
      `);
      console.log('✓ Added index on fund_centre_id for holiday_calendar');
    } else {
      console.log('⏭ Index idx_fund_centre_id already exists');
    }
    
    // Check and add foreign key (only if fund_centre_master table exists)
    const [tables] = await db.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'fund_centre_master'
    `);
    
    if (tables.length > 0) {
      const [fks] = await db.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'holiday_calendar' 
        AND CONSTRAINT_NAME = 'fk_holiday_calendar_fund_centre'
      `);
      
      if (fks.length === 0) {
        await db.query(`
          ALTER TABLE holiday_calendar 
          ADD CONSTRAINT fk_holiday_calendar_fund_centre 
          FOREIGN KEY (fund_centre_id) 
          REFERENCES fund_centre_master(id) 
          ON DELETE SET NULL 
          ON UPDATE CASCADE
        `);
        console.log('✓ Added foreign key constraint for fund_centre_id');
      } else {
        console.log('⏭ Foreign key fk_holiday_calendar_fund_centre already exists');
      }
    } else {
      console.log('⏭ fund_centre_master table does not exist yet, skipping foreign key');
    }
    
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  addFundCentreToHolidayCalendar()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addFundCentreToHolidayCalendar;
