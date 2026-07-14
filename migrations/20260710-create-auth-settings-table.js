/**
 * Single-row settings table for global auth state: when an admin runs EOD, all
 * other logged-in users must be forced to log in again. Since auth is stateless
 * JWT with no session table, this stores a "force logout everyone whose token
 * was issued before this timestamp" cutoff, plus the triggering admin's user id
 * so their own session is exempted from the cutoff they just set.
 *
 * Run: node migrations/20260710-create-auth-settings-table.js
 */
const db = require('../config/database');

async function run() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_settings (
      id INT PRIMARY KEY,
      force_logout_at DATETIME NULL,
      force_logout_exempt_user_id INT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(
    'INSERT IGNORE INTO auth_settings (id, force_logout_at, force_logout_exempt_user_id) VALUES (1, NULL, NULL)'
  );
  console.log('auth_settings table ready.');
  process.exit(0);
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run };
