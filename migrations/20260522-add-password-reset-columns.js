const db = require('../config/database');

async function addPasswordResetColumns() {
  try {
    console.log('Adding password reset columns to users table...');
    
    // Add resetPasswordToken column
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN resetPasswordToken VARCHAR(255) NULL
    `);
    console.log('Added resetPasswordToken column');
    
    // Add resetPasswordExpires column
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN resetPasswordExpires DATETIME NULL
    `);
    console.log('Added resetPasswordExpires column');
    
    // Add email column if it doesn't exist (for password reset functionality)
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN email VARCHAR(255) NULL
    `);
    console.log('Added email column');
    
    // Add index for email lookups
    await db.query(`
      CREATE INDEX idx_users_email ON users(email)
    `);
    console.log('Added email index');
    
    // Add index for reset token lookups
    await db.query(`
      CREATE INDEX idx_users_reset_token ON users(resetPasswordToken)
    `);
    console.log('Added reset token index');
    
    console.log('Password reset columns added successfully');
  } catch (error) {
    // Handle case where columns might already exist
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('Password reset columns already exist, skipping...');
    } else {
      console.error('Error adding password reset columns:', error);
      throw error;
    }
  }
}

// Run the migration
if (require.main === module) {
  addPasswordResetColumns()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = addPasswordResetColumns;