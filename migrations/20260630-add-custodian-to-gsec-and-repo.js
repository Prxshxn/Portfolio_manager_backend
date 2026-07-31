/**
 * Add custodian column to gsec and repo_deals (tbill and buyback_deals
 * already have one). Required for the Daily Portfolio Balancing Report's
 * per-custodian columns (Seylan / DFCC / Cargills / In Hand).
 *
 * Additive, nullable - existing rows show no custodian until populated at
 * deal entry going forward.
 *
 * Run: npm run migrate
 */

const db = require('../config/database');

async function columnExists(table, columnName) {
  const [rows] = await db.query(
    `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, columnName]
  );
  return rows.length > 0;
}

async function run() {
  if (!(await columnExists('gsec', 'custodian'))) {
    await db.query(`ALTER TABLE gsec ADD COLUMN custodian VARCHAR(100) NULL`);
    console.log('Added gsec.custodian column');
  } else {
    console.log('gsec.custodian already exists, skipping');
  }

  if (!(await columnExists('repo_deals', 'custodian'))) {
    await db.query(`ALTER TABLE repo_deals ADD COLUMN custodian VARCHAR(100) NULL`);
    console.log('Added repo_deals.custodian column');
  } else {
    console.log('repo_deals.custodian already exists, skipping');
  }
}

if (require.main === module) {
  run()
    .then(() => {
      console.log('Custodian column migration completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = run;
module.exports.run = run;
