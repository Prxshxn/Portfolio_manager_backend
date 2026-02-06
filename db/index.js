const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

// Connect to default database but allow cross-database queries using database.table format
// Queries without prefix will use the default database, queries with prefix (e.g., itms.table) will work too
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'ITMS-LV1', // Default database, but can still query other databases
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Fix date handling to prevent timezone conversion issues
  dateStrings: false,
  timezone: '+00:00'
});

module.exports = pool;
