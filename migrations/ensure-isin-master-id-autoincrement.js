/**
 * Ensure isin_master.id is AUTO_INCREMENT so new ISINs get unique incremental ids.
 * Safe to run multiple times.
 */
const db = require('../config/db');

async function ensureIsinMasterIdAutoIncrement() {
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'isin_master'
        AND COLUMN_NAME = 'id'
    `);
    if (cols.length === 0) {
      console.log('⏭ isin_master table or id column not found; skip.');
      return;
    }
    const hasAutoIncrement = String(cols[0].EXTRA || '').toLowerCase().includes('auto_increment');
    if (hasAutoIncrement) {
      console.log('⏭ isin_master.id already has AUTO_INCREMENT');
      return;
    }
    await db.query(`
      ALTER TABLE isin_master
      MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT PRIMARY KEY
    `);
    console.log('✓ isin_master.id set to AUTO_INCREMENT');
  } catch (err) {
    console.error('Migration ensure-isin-master-id-autoincrement failed:', err.message);
    throw err;
  }
}

if (require.main === module) {
  ensureIsinMasterIdAutoIncrement()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = ensureIsinMasterIdAutoIncrement;
