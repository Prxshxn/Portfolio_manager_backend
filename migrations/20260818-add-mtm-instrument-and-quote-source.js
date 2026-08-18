/**
 * Add instrument_type and quote_source to mark_to_market so T-bills and
 * interpolated (unquoted) ISINs can be stored alongside Excel T-bond quotes.
 */

const db = require('../config/database');

async function addColumnIfMissing(columnName, ddl) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'mark_to_market'
       AND COLUMN_NAME = ?`,
    [columnName]
  );
  if (rows[0] && Number(rows[0].c) > 0) {
    console.log(`Column mark_to_market.${columnName} already exists, skipping.`);
    return;
  }
  await db.query(`ALTER TABLE mark_to_market ADD COLUMN ${ddl}`);
  console.log(`Added mark_to_market.${columnName}`);
}

async function up() {
  await addColumnIfMissing(
    'instrument_type',
    `instrument_type VARCHAR(16) NULL COMMENT 'T_BOND or T_BILL' AFTER isin_number`
  );
  await addColumnIfMissing(
    'quote_source',
    `quote_source VARCHAR(16) NULL COMMENT 'excel or interpolated' AFTER excel_source`
  );

  await db.query(`
    UPDATE mark_to_market
    SET instrument_type = CASE
          WHEN UPPER(TRIM(isin_number)) LIKE 'LKA%' THEN 'T_BILL'
          ELSE 'T_BOND'
        END,
        quote_source = COALESCE(NULLIF(quote_source, ''), 'excel')
    WHERE instrument_type IS NULL OR quote_source IS NULL
  `);
}

if (require.main === module) {
  up()
    .then(() => {
      console.log('mark_to_market instrument_type/quote_source migration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { up };
