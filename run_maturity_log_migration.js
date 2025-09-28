const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();

(async () => {
  let conn;
  try {
    console.log('Connecting to DB...');
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'Prashan@321',
      database: process.env.DB_NAME || 'portfolio_manager'
    });

    const sql = fs.readFileSync('./migrations/20250101-create-maturity-processing-log.sql', 'utf8');
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    for (const stmt of statements) {
      try {
        console.log('Executing:', stmt.substring(0, 80) + (stmt.length > 80 ? '...' : ''));
        await conn.execute(stmt);
        console.log('✓ Success');
      } catch (err) {
        // If table exists or similar, continue
        console.log('⚠ Skipped:', err.code || err.message);
      }
    }
    console.log('Migration complete.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
})();
