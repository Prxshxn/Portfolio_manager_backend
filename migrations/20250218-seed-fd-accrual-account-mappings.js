const db = require('../config/database');

async function seedFdAccrualAccountMappings() {
  try {
    const [existing] = await db.query(
      `SELECT mapping_key FROM account_mappings WHERE mapping_key IN ('FD_ACCRUAL_ASSET', 'FD_ACCRUAL_INCOME')`
    );
    const keys = existing.map(r => r.mapping_key);
    if (keys.includes('FD_ACCRUAL_ASSET') && keys.includes('FD_ACCRUAL_INCOME')) {
      console.log('FD accrual account mappings already exist, skipping.');
      return;
    }
    const [gsec] = await db.query(
      `SELECT mapping_key, account_code, description FROM account_mappings 
       WHERE mapping_key IN ('GSEC_ACCRUAL_ASSET', 'GSEC_ACCRUAL_INCOME') AND is_active = TRUE`
    );
    const gsecByKey = {};
    gsec.forEach(r => { gsecByKey[r.mapping_key] = r; });
    if (!gsecByKey.GSEC_ACCRUAL_ASSET || !gsecByKey.GSEC_ACCRUAL_INCOME) {
      console.log('GSEC accrual mappings not found. Configure FD_ACCRUAL_ASSET and FD_ACCRUAL_INCOME via account-mappings API.');
      return;
    }
    if (!keys.includes('FD_ACCRUAL_ASSET')) {
      await db.query(
        `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, TRUE, NOW(), NOW())
         ON DUPLICATE KEY UPDATE account_code = VALUES(account_code), description = VALUES(description), updated_at = NOW()`,
        ['FD_ACCRUAL_ASSET', gsecByKey.GSEC_ACCRUAL_ASSET.account_code, 'Fixed Deposit Daily Accrual Asset']
      );
      console.log('  Inserted FD_ACCRUAL_ASSET (using same account as GSEC_ACCRUAL_ASSET).');
    }
    if (!keys.includes('FD_ACCRUAL_INCOME')) {
      await db.query(
        `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, TRUE, NOW(), NOW())
         ON DUPLICATE KEY UPDATE account_code = VALUES(account_code), description = VALUES(description), updated_at = NOW()`,
        ['FD_ACCRUAL_INCOME', gsecByKey.GSEC_ACCRUAL_INCOME.account_code, 'Fixed Deposit Daily Accrual Income']
      );
      console.log('  Inserted FD_ACCRUAL_INCOME (using same account as GSEC_ACCRUAL_INCOME).');
    }
    console.log('FD accrual account mappings seed completed.');
  } catch (error) {
    console.error('FD accrual account mappings seed failed:', error);
    throw error;
  }
}

if (require.main === module) {
  seedFdAccrualAccountMappings()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = seedFdAccrualAccountMappings;
