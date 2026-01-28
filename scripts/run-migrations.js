const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'portfolio_manager',
  multipleStatements: true
};

// Create migrations tracking table
async function createMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
  console.log('✓ Migrations tracking table ready');
}

// Check if migration has been run
async function isMigrationRun(connection, filename) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) as count FROM migrations WHERE filename = ?',
    [filename]
  );
  return rows[0].count > 0;
}

// Mark migration as run
async function markMigrationRun(connection, filename) {
  await connection.query(
    'INSERT INTO migrations (filename) VALUES (?) ON DUPLICATE KEY UPDATE filename = filename',
    [filename]
  );
}

// Execute SQL file
async function executeSqlFile(connection, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && !s.startsWith('/*'));
  
  for (const statement of statements) {
    if (statement.length > 0) {
      try {
        await connection.query(statement);
      } catch (error) {
        // Ignore "table already exists" errors
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.code === 'ER_DUP_FIELDNAME') {
          console.log(`  ⚠ Skipped (already exists): ${error.message.substring(0, 60)}...`);
        } else {
          throw error;
        }
      }
    }
  }
}

// Execute JS migration file
async function executeJsFile(connection, filePath) {
  // Create a mock db object that uses our connection
  const mockDb = {
    query: async (sql, params) => {
      try {
        const result = await connection.query(sql, params);
        return result;
      } catch (error) {
        // Ignore "table already exists" errors
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || 
            error.code === 'ER_DUP_FIELDNAME' ||
            error.code === 'ER_DUP_KEYNAME') {
          console.log(`  ⚠ Skipped (already exists)`);
          return [[], []];
        }
        throw error;
      }
    },
    getConnection: async () => connection,
    end: async () => {},
    pool: connection
  };
  
  // Store original modules
  const dbPath = path.resolve(__dirname, '../config/db.js');
  const databasePath = path.resolve(__dirname, '../config/database.js');
  const originalDb = require.cache[dbPath];
  const originalDatabase = require.cache[databasePath];
  
  // Override require cache
  if (fs.existsSync(dbPath)) {
    require.cache[dbPath] = {
      exports: mockDb,
      loaded: true
    };
  }
  if (fs.existsSync(databasePath)) {
    require.cache[databasePath] = {
      exports: mockDb,
      loaded: true
    };
  }
  
  // Override process.exit to prevent migrations from exiting
  const originalExit = process.exit;
  let exitCalled = false;
  let exitCode = 0;
  process.exit = (code) => {
    exitCalled = true;
    exitCode = code || 0;
  };
  
  try {
    // Clear require cache for the migration file
    delete require.cache[require.resolve(filePath)];
    
    // Execute the migration file
    const migrationModule = require(filePath);
    
    // If migration exports a function, call it
    if (typeof migrationModule === 'function') {
      await migrationModule();
    } else if (migrationModule.default && typeof migrationModule.default === 'function') {
      await migrationModule.default();
    }
    
    // Wait a bit for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Check if process.exit was called
    if (exitCalled && exitCode !== 0) {
      throw new Error(`Migration exited with code ${exitCode}`);
    }
  } catch (error) {
    // If it's a table exists error, that's okay
    if (error.code === 'ER_TABLE_EXISTS_ERROR' || 
        error.code === 'ER_DUP_FIELDNAME' ||
        error.code === 'ER_DUP_KEYNAME') {
      console.log(`  ⚠ Skipped (already exists)`);
    } else {
      throw error;
    }
  } finally {
    // Restore original modules
    if (originalDb) {
      require.cache[dbPath] = originalDb;
    } else {
      delete require.cache[dbPath];
    }
    if (originalDatabase) {
      require.cache[databasePath] = originalDatabase;
    } else {
      delete require.cache[databasePath];
    }
    
    // Restore process.exit
    process.exit = originalExit;
  }
}

// Get all migration files sorted by name
function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir);
  
  // Filter and sort migration files
  const migrationFiles = files
    .filter(file => {
      // Include dated migrations and specific files
      return (
        file.endsWith('.js') || 
        file.endsWith('.sql')
      ) && !file.startsWith('run_') && file !== 'create-chart-of-accounts.sql';
    })
    .map(file => ({
      name: file,
      path: path.join(migrationsDir, file),
      ext: path.extname(file),
      date: extractDate(file)
    }))
    .sort((a, b) => {
      // Sort by date if available, otherwise by filename
      if (a.date && b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.name.localeCompare(b.name);
    });
  
  // Add chart of accounts after accounting tables (if it exists and not already in list)
  const chartOfAccountsPath = path.join(migrationsDir, 'create-chart-of-accounts.sql');
  if (fs.existsSync(chartOfAccountsPath)) {
    const chartOfAccountsFile = {
      name: 'create-chart-of-accounts.sql',
      path: chartOfAccountsPath,
      ext: '.sql',
      date: '99999999' // Put it at the end
    };
    
    // Check if it's not already in the list
    const alreadyIncluded = migrationFiles.some(f => f.name === 'create-chart-of-accounts.sql');
    
    if (!alreadyIncluded) {
      // Find position after accounting tables
      const accountingIndex = migrationFiles.findIndex(f => 
        f.name.includes('accounting') || f.name.includes('account-types') || f.name.includes('20250501')
      );
      
      if (accountingIndex >= 0) {
        migrationFiles.splice(accountingIndex + 1, 0, chartOfAccountsFile);
      } else {
        migrationFiles.push(chartOfAccountsFile);
      }
    }
  }
  
  return migrationFiles;
}

// Extract date from filename (YYYYMMDD format)
function extractDate(filename) {
  const match = filename.match(/^(\d{8})/);
  return match ? match[1] : null;
}

// Main migration runner
async function runMigrations() {
  let connection;
  
  try {
    console.log('🚀 Starting database migrations...\n');
    console.log(`📊 Database: ${dbConfig.database}`);
    console.log(`🔗 Host: ${dbConfig.host}:${dbConfig.port}\n`);
    
    // Create connection
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ Connected to database\n');
    
    // Ensure database exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    await connection.query(`USE ${dbConfig.database}`);
    
    // Create migrations tracking table
    await createMigrationsTable(connection);
    
    // Get all migration files
    const migrationFiles = getMigrationFiles();
    console.log(`📁 Found ${migrationFiles.length} migration files\n`);
    
    let executed = 0;
    let skipped = 0;
    
    // Execute each migration
    for (const file of migrationFiles) {
      const isRun = await isMigrationRun(connection, file.name);
      
      if (isRun) {
        console.log(`⏭  Skipped: ${file.name} (already executed)`);
        skipped++;
        continue;
      }
      
      try {
        console.log(`▶  Running: ${file.name}`);
        
        if (file.ext === '.sql') {
          await executeSqlFile(connection, file.path);
        } else if (file.ext === '.js') {
          await executeJsFile(connection, file.path);
        }
        
        await markMigrationRun(connection, file.name);
        console.log(`✓ Completed: ${file.name}\n`);
        executed++;
      } catch (error) {
        console.error(`✗ Failed: ${file.name}`);
        console.error(`  Error: ${error.message}`);
        
        // Continue with other migrations even if one fails
        if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.code === 'ER_DUP_FIELDNAME') {
          console.log(`  ⚠ Marking as completed (table/column already exists)`);
          await markMigrationRun(connection, file.name);
          skipped++;
        } else {
          throw error;
        }
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Migration Summary:`);
    console.log(`   Executed: ${executed}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${migrationFiles.length}`);
    console.log('='.repeat(50) + '\n');
    
    // Verify tables were created
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`📋 Total tables in database: ${tables.length}`);
    
    if (tables.length > 0) {
      console.log('\n📊 Tables created:');
      tables.forEach((table, index) => {
        const tableName = Object.values(table)[0];
        console.log(`   ${index + 1}. ${tableName}`);
      });
    }
    
    console.log('\n✅ All migrations completed successfully!\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed\n');
    }
  }
}

// Run migrations
if (require.main === module) {
  runMigrations().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runMigrations };
