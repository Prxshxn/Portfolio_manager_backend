/**
 * Ensure chart_of_accounts.id is NOT NULL AUTO_INCREMENT PRIMARY KEY.
 * Also backfills any existing rows where id is NULL.
 *
 * Safe to run multiple times.
 */
const db = require('../config/db');

async function ensureChartOfAccountsIdAutoIncrement() {
  try {
    const [tableRows] = await db.query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'chart_of_accounts'
    `);

    if (!tableRows.length) {
      console.log('⏭ chart_of_accounts table not found; skip.');
      return;
    }

    const [idCols] = await db.query(`
      SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_KEY, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'chart_of_accounts'
        AND COLUMN_NAME = 'id'
    `);

    if (!idCols.length) {
      console.log('⏭ chart_of_accounts.id column not found; skip.');
      return;
    }

    const [nullRows] = await db.query(`
      SELECT account_code
      FROM chart_of_accounts
      WHERE id IS NULL
      ORDER BY account_code
    `);

    if (nullRows.length) {
      const [maxRows] = await db.query(
        'SELECT COALESCE(MAX(id), 0) AS maxId FROM chart_of_accounts'
      );
      let nextId = Number(maxRows[0].maxId) + 1;
      console.log(`Backfilling ${nullRows.length} chart_of_accounts row(s) with NULL id...`);

      for (const row of nullRows) {
        await db.query(
          'UPDATE chart_of_accounts SET id = ? WHERE account_code = ? AND id IS NULL',
          [nextId, row.account_code]
        );
        nextId += 1;
      }
    }

    const idCol = idCols[0];
    const hasAutoIncrement = String(idCol.EXTRA || '').toLowerCase().includes('auto_increment');
    const isPrimaryKey = String(idCol.COLUMN_KEY || '').toUpperCase() === 'PRI';
    const isNullable = String(idCol.IS_NULLABLE || '').toUpperCase() === 'YES';

    if (hasAutoIncrement && isPrimaryKey && !isNullable) {
      console.log('⏭ chart_of_accounts.id already configured correctly');
      return;
    }

    await db.query(`
      ALTER TABLE chart_of_accounts
      MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT,
      ADD PRIMARY KEY (id)
    `);

    console.log('✓ chart_of_accounts.id set to NOT NULL AUTO_INCREMENT PRIMARY KEY');
  } catch (err) {
    // Ignore duplicate primary key error (already has PK), then ensure AUTO_INCREMENT/NOT NULL is set.
    if (err && err.code === 'ER_MULTIPLE_PRI_KEY') {
      await db.query(`
        ALTER TABLE chart_of_accounts
        MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT
      `);
      console.log('✓ chart_of_accounts.id set to NOT NULL AUTO_INCREMENT (PK already existed)');
      return;
    }

    console.error('Migration 20260429 ensure-chart-of-accounts-id-autoincrement failed:', err.message);
    throw err;
  }
}

if (require.main === module) {
  ensureChartOfAccountsIdAutoIncrement()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = ensureChartOfAccountsIdAutoIncrement;
