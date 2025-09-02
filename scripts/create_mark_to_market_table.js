const db = require('../config/database');

const createMarkToMarketTable = async () => {
  try {
    console.log('🔄 Creating mark_to_market table...');

    const sql = `
      CREATE TABLE IF NOT EXISTS mark_to_market (
        id INT AUTO_INCREMENT PRIMARY KEY,
        series VARCHAR(50) NOT NULL,
        isin_number VARCHAR(50) NOT NULL,
        isin_issuer VARCHAR(255),
        maturity_date DATE,
        buying_price DECIMAL(10, 4),
        selling_price DECIMAL(10, 4),
        average_price DECIMAL(10, 4),
        buying_yield DECIMAL(10, 4),
        selling_yield DECIMAL(10, 4),
        average_yield DECIMAL(10, 4),
        dirty_price DECIMAL(10, 4),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        excel_source VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- Indexes for better performance
        INDEX idx_series (series),
        INDEX idx_isin_number (isin_number),
        INDEX idx_maturity_date (maturity_date),
        INDEX idx_last_updated (last_updated),
        INDEX idx_excel_source (excel_source),
        
        -- Unique constraint to prevent duplicate series entries
        UNIQUE KEY unique_series (series)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await db.query(sql);
    console.log('✅ mark_to_market table created successfully!');

    // Insert sample data for testing
    console.log('📊 Inserting sample data...');
    
    const sampleData = [
      {
        series: '10.35%2025A',
        isin_number: 'IN002025A001',
        isin_issuer: 'Government of India',
        maturity_date: '2025-01-15',
        buying_price: 98.50,
        selling_price: 98.75,
        average_price: 98.625,
        buying_yield: 10.25,
        selling_yield: 10.20,
        average_yield: 10.225,
        dirty_price: 98.625,
        excel_source: 'sample_treasury_bonds.xlsx'
      },
      {
        series: '8.24%2026A',
        isin_number: 'IN002026A001',
        isin_issuer: 'Government of India',
        maturity_date: '2026-02-15',
        buying_price: 97.25,
        selling_price: 97.50,
        average_price: 97.375,
        buying_yield: 8.50,
        selling_yield: 8.45,
        average_yield: 8.475,
        dirty_price: 97.375,
        excel_source: 'sample_treasury_bonds.xlsx'
      },
      {
        series: '7.10%2027A',
        isin_number: 'IN002027A001',
        isin_issuer: 'Government of India',
        maturity_date: '2027-03-15',
        buying_price: 95.80,
        selling_price: 96.00,
        average_price: 95.90,
        buying_yield: 7.35,
        selling_yield: 7.30,
        average_yield: 7.325,
        dirty_price: 95.90,
        excel_source: 'sample_treasury_bonds.xlsx'
      }
    ];

    for (const data of sampleData) {
      const insertSql = `
        INSERT INTO mark_to_market (
          series, isin_number, isin_issuer, maturity_date,
          buying_price, selling_price, average_price,
          buying_yield, selling_yield, average_yield,
          dirty_price, excel_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          isin_issuer = VALUES(isin_issuer),
          maturity_date = VALUES(maturity_date),
          buying_price = VALUES(buying_price),
          selling_price = VALUES(selling_price),
          average_price = VALUES(average_price),
          buying_yield = VALUES(buying_yield),
          selling_yield = VALUES(selling_yield),
          average_yield = VALUES(average_yield),
          dirty_price = VALUES(dirty_price),
          excel_source = VALUES(excel_source),
          last_updated = CURRENT_TIMESTAMP
      `;

      const values = [
        data.series, data.isin_number, data.isin_issuer, data.maturity_date,
        data.buying_price, data.selling_price, data.average_price,
        data.buying_yield, data.selling_yield, data.average_yield,
        data.dirty_price, data.excel_source
      ];

      await db.query(insertSql, values);
      console.log(`✅ Inserted sample data for series: ${data.series}`);
    }

    // Verify the table was created and data inserted
    const [rows] = await db.query('SELECT COUNT(*) as count FROM mark_to_market');
    console.log(`📊 Total records in mark_to_market table: ${rows[0].count}`);

    // Show table structure
    const [structure] = await db.query('DESCRIBE mark_to_market');
    console.log('📋 Table structure:');
    structure.forEach(column => {
      console.log(`  - ${column.Field}: ${column.Type} ${column.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${column.Key ? `(${column.Key})` : ''}`);
    });

    console.log('🎉 Mark-to-Market table migration completed successfully!');

  } catch (error) {
    console.error('❌ Error creating mark_to_market table:', error);
    throw error;
  }
};

// Run the migration
createMarkToMarketTable()
  .then(() => {
    console.log('✅ Migration completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
