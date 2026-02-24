const db = require('../config/database');

async function listAllTables() {
  try {
    const [tables] = await db.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]).sort();
    
    console.log('\n=== All Database Tables ===\n');
    tableNames.forEach((table, index) => {
      console.log(`${index + 1}. ${table}`);
    });
    console.log(`\nTotal: ${tableNames.length} tables\n`);
    
    // Now check which ones have migration files
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, '../migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.js') || f.endsWith('.sql'))
      .map(f => f.toLowerCase());
    
    console.log('=== Migration Files Analysis ===\n');
    
    const tablesWithMigrations = [];
    const tablesWithoutMigrations = [];
    
    tableNames.forEach(table => {
      // Check if there's a migration file that mentions this table
      const hasMigration = migrationFiles.some(file => {
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8').toLowerCase();
        const fileName = file.toLowerCase();
        const tableNameLower = table.toLowerCase();
        
        // Check for raw SQL CREATE TABLE
        const hasCreateTable = content.includes(`create table`) || content.includes(`create_table`);
        // Check for Sequelize migrations
        const hasSequelizeCreate = content.includes(`createtable`) || content.includes(`createTable`);
        // Check if table name appears in content or filename
        const mentionsTable = content.includes(tableNameLower) || 
                             content.includes(`'${tableNameLower}'`) ||
                             content.includes(`"${tableNameLower}"`) ||
                             fileName.includes(tableNameLower.replace(/_/g, '-'));
        
        return (hasCreateTable || hasSequelizeCreate) && mentionsTable;
      });
      
      if (hasMigration) {
        tablesWithMigrations.push(table);
      } else {
        tablesWithoutMigrations.push(table);
      }
    });
    
    console.log(`Tables WITH migration files: ${tablesWithMigrations.length}`);
    tablesWithMigrations.forEach(t => console.log(`  ✓ ${t}`));
    
    console.log(`\nTables WITHOUT migration files: ${tablesWithoutMigrations.length}`);
    tablesWithoutMigrations.forEach(t => console.log(`  ✗ ${t}`));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit();
  }
}

listAllTables();
