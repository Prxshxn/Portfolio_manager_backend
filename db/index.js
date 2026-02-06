const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

// Note: database property is removed to allow connection to any database on the server
// Queries should use database.table format (e.g., itms.fund_centre_master)
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // database: process.env.DB_NAME, // Removed - connect without specifying database
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Fix date handling to prevent timezone conversion issues
  dateStrings: false,
  timezone: '+00:00'
});

module.exports = pool;
