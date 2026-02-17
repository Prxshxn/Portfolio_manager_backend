const db = require('../config/db');

async function addPreApprovalFields() {
  try {
    console.log('Adding pre-approval fields to product tables...');
    
    const tables = [
      { name: 'gsec', displayName: 'GSEC' },
      { name: 'money_market_deals', displayName: 'Money Market Deals' },
      { name: 'fixed_deposit_requests', displayName: 'Fixed Deposit Requests' },
      { name: 'repo_deals', displayName: 'Repo Deals' }
    ];
    
    for (const table of tables) {
      try {
        // Check existing columns
        const [columns] = await db.query(`DESCRIBE ${table.name}`);
        const columnNames = columns.map(col => col.Field);
        
        // Add pre_approved column
        if (!columnNames.includes('pre_approved')) {
          // Find a suitable column to add after (prefer updated_at, then approved_at, then last column)
          let afterColumn = 'updated_at';
          if (!columnNames.includes('updated_at')) {
            if (columnNames.includes('approved_at')) {
              afterColumn = 'approved_at';
            } else {
              // Use last column
              const lastCol = columns[columns.length - 1];
              afterColumn = lastCol ? lastCol.Field : '';
            }
          }
          
          const afterClause = afterColumn ? `AFTER ${afterColumn}` : '';
          await db.query(`
            ALTER TABLE ${table.name} 
            ADD COLUMN pre_approved TINYINT(1) DEFAULT 0 ${afterClause}
          `);
          console.log(`  ✓ Added pre_approved to ${table.displayName}`);
        } else {
          console.log(`  - pre_approved already exists in ${table.displayName}`);
        }
        
        // Add pre_approved_by column
        if (!columnNames.includes('pre_approved_by')) {
          await db.query(`
            ALTER TABLE ${table.name} 
            ADD COLUMN pre_approved_by INT NULL AFTER pre_approved
          `);
          console.log(`  ✓ Added pre_approved_by to ${table.displayName}`);
        } else {
          console.log(`  - pre_approved_by already exists in ${table.displayName}`);
        }
        
        // Add pre_approved_at column
        if (!columnNames.includes('pre_approved_at')) {
          await db.query(`
            ALTER TABLE ${table.name} 
            ADD COLUMN pre_approved_at DATETIME NULL AFTER pre_approved_by
          `);
          console.log(`  ✓ Added pre_approved_at to ${table.displayName}`);
        } else {
          console.log(`  - pre_approved_at already exists in ${table.displayName}`);
        }
        
        // Add pre_approval_status column
        if (!columnNames.includes('pre_approval_status')) {
          await db.query(`
            ALTER TABLE ${table.name} 
            ADD COLUMN pre_approval_status VARCHAR(20) NULL DEFAULT NULL 
            AFTER pre_approved_at
          `);
          console.log(`  ✓ Added pre_approval_status to ${table.displayName}`);
        } else {
          console.log(`  - pre_approval_status already exists in ${table.displayName}`);
        }
        
        // Add pre_approval_authorized_by column (for authorizer who approves pre-approval)
        if (!columnNames.includes('pre_approval_authorized_by')) {
          await db.query(`
            ALTER TABLE ${table.name} 
            ADD COLUMN pre_approval_authorized_by INT NULL AFTER pre_approval_status
          `);
          console.log(`  ✓ Added pre_approval_authorized_by to ${table.displayName}`);
        } else {
          console.log(`  - pre_approval_authorized_by already exists in ${table.displayName}`);
        }
        
        // Add pre_approval_authorized_at column
        if (!columnNames.includes('pre_approval_authorized_at')) {
          await db.query(`
            ALTER TABLE ${table.name} 
            ADD COLUMN pre_approval_authorized_at DATETIME NULL AFTER pre_approval_authorized_by
          `);
          console.log(`  ✓ Added pre_approval_authorized_at to ${table.displayName}`);
        } else {
          console.log(`  - pre_approval_authorized_at already exists in ${table.displayName}`);
        }
        
      } catch (tableError) {
        // Skip if table doesn't exist
        if (tableError.code === 'ER_NO_SUCH_TABLE') {
          console.log(`  ⚠ Table ${table.name} does not exist, skipping...`);
        } else {
          throw tableError;
        }
      }
    }
    
    console.log('\nPre-approval fields migration completed successfully');
  } catch (error) {
    console.error('Error adding pre-approval fields:', error);
    throw error;
  }
}

if (require.main === module) {
  addPreApprovalFields()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = addPreApprovalFields;
