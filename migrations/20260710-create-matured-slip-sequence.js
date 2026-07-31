/**
 * Persistent monthly counter for Matured Deal Slip ticket numbers
 * (format YYYYMM-#### e.g. 202607-0024). One row per YYYYMM period.
 *
 * Run: node migrations/20260710-create-matured-slip-sequence.js
 */
const db = require('../config/database');

async function run() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS matured_slip_sequence (
      period_ym CHAR(6) PRIMARY KEY,
      last_seq INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('matured_slip_sequence table ready.');
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run };
