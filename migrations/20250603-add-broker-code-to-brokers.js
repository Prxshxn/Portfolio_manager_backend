const db = require('../config/db');

async function addBrokerCodeToBrokers() {
  try {
    const tableName = 'brokers';
    const [tables] = await db.query(`SHOW TABLES LIKE '${tableName}'`);
    if (tables.length === 0) {
      console.log(`Table ${tableName} does not exist. Run migrations/20250603-create-brokers-table.sql first.`);
      return;
    }

    const [columns] = await db.query(`DESCRIBE ${tableName}`);
    const columnNames = columns.map(col => col.Field);

    // Columns expected by brokerController (add if missing)
    const toAdd = [
      { name: 'broker_code', sql: 'VARCHAR(50) NULL', after: 'id' },
      { name: 'broker_name', sql: 'VARCHAR(100) NULL', after: 'broker_code' },
      { name: 'building_number', sql: 'VARCHAR(50) NULL', after: 'broker_name' },
      { name: 'street_name', sql: 'VARCHAR(100) NULL', after: 'building_number' },
      { name: 'street_name2', sql: 'VARCHAR(100) NULL', after: 'street_name' },
      { name: 'city', sql: 'VARCHAR(100) NULL', after: 'street_name2' },
      { name: 'province', sql: 'VARCHAR(100) NULL', after: 'city' },
      { name: 'zip_code', sql: 'VARCHAR(20) NULL', after: 'province' },
      { name: 'country', sql: 'VARCHAR(100) NULL', after: 'zip_code' },
      { name: 'contact_name', sql: 'VARCHAR(100) NULL', after: 'country' },
      { name: 'contact_phone', sql: 'VARCHAR(30) NULL', after: 'contact_name' },
      { name: 'contact_mobile', sql: 'VARCHAR(30) NULL', after: 'contact_phone' },
      { name: 'contact_fax', sql: 'VARCHAR(30) NULL', after: 'contact_mobile' },
      { name: 'contact_email', sql: 'VARCHAR(100) NULL', after: 'contact_fax' },
      { name: 'broker_type', sql: 'VARCHAR(20) NULL', after: 'contact_email' },
      { name: 'brokerage_method', sql: 'VARCHAR(20) NULL', after: 'broker_type' },
      { name: 'brokerage_cal_method_id', sql: 'INT NULL', after: 'brokerage_method' },
      { name: 'brokerage_input_percentage', sql: 'DECIMAL(10,4) NULL', after: 'brokerage_cal_method_id' },
      { name: 'brokerage_settlement_method_id', sql: 'INT NULL', after: 'brokerage_input_percentage' },
      { name: 'settlement_account_number', sql: 'VARCHAR(100) NULL', after: 'brokerage_settlement_method_id' },
    ];

    for (const col of toAdd) {
      if (!columnNames.includes(col.name)) {
        const afterClause = col.after && columnNames.includes(col.after) ? ` AFTER ${col.after}` : '';
        await db.query(`
          ALTER TABLE ${tableName}
          ADD COLUMN ${col.name} ${col.sql}${afterClause}
        `);
        console.log(`  Added ${col.name} to ${tableName}`);
        columnNames.push(col.name);
      } else {
        console.log(`  ${col.name} already exists in ${tableName}`);
      }
    }

    console.log('Brokers table migration completed successfully');
  } catch (error) {
    console.error('Brokers table migration failed:', error);
    throw error;
  }
}

if (require.main === module) {
  addBrokerCodeToBrokers()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = addBrokerCodeToBrokers;
