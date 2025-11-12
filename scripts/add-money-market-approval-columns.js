// Script to add approval columns to money_market_deals table
const pool = require('../db/index');

async function addColumns() {
  try {
    console.log('Adding approval columns to money_market_deals table...');
    
    // Check and add status column
    const [statusCheck] = await pool.query("SHOW COLUMNS FROM money_market_deals LIKE 'status'");
    if (!statusCheck.length) {
      await pool.query("ALTER TABLE money_market_deals ADD COLUMN status VARCHAR(20) DEFAULT 'pending' AFTER remarks");
      console.log('✓ Added status column');
    } else {
      console.log('✓ status column already exists');
    }

    // Check and add comment column
    const [commentCheck] = await pool.query("SHOW COLUMNS FROM money_market_deals LIKE 'comment'");
    if (!commentCheck.length) {
      await pool.query("ALTER TABLE money_market_deals ADD COLUMN comment TEXT AFTER status");
      console.log('✓ Added comment column');
    } else {
      console.log('✓ comment column already exists');
    }

    // Check and add current_approval_level column
    const [approvalLevelCheck] = await pool.query("SHOW COLUMNS FROM money_market_deals LIKE 'current_approval_level'");
    if (!approvalLevelCheck.length) {
      await pool.query("ALTER TABLE money_market_deals ADD COLUMN current_approval_level VARCHAR(50) DEFAULT 'front_office' AFTER comment");
      console.log('✓ Added current_approval_level column');
    } else {
      console.log('✓ current_approval_level column already exists');
    }

    // Check and add authorized_by column
    const [authorizedByCheck] = await pool.query("SHOW COLUMNS FROM money_market_deals LIKE 'authorized_by'");
    if (!authorizedByCheck.length) {
      await pool.query("ALTER TABLE money_market_deals ADD COLUMN authorized_by INT AFTER updated_at");
      console.log('✓ Added authorized_by column');
    } else {
      console.log('✓ authorized_by column already exists');
    }

    // Check and add authorized_at column
    const [authorizedAtCheck] = await pool.query("SHOW COLUMNS FROM money_market_deals LIKE 'authorized_at'");
    if (!authorizedAtCheck.length) {
      await pool.query("ALTER TABLE money_market_deals ADD COLUMN authorized_at DATETIME AFTER authorized_by");
      console.log('✓ Added authorized_at column');
    } else {
      console.log('✓ authorized_at column already exists');
    }

    console.log('\nAll columns added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error adding columns:', error);
    process.exit(1);
  }
}

addColumns();

