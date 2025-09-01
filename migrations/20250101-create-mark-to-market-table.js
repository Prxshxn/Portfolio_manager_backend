const db = require('../config/database');

const createMarkToMarketTable = async () => {
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
      upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      
      INDEX idx_series (series),
      INDEX idx_isin (isin_number),
      INDEX idx_last_updated (last_updated),
      UNIQUE KEY unique_series_isin (series, isin_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  try {
    await db.query(sql);
    console.log('✅ Mark-to-Market table created successfully');
  } catch (error) {
    console.error('❌ Error creating Mark-to-Market table:', error);
    throw error;
  }
};

// Sample data insertion
const insertSampleData = async () => {
  const sampleData = [
    {
      series: '10.35%2025A',
      isin_number: 'LK5008251156',
      isin_issuer: 'Treasury Bond 10.35% 2025',
      maturity_date: '2025-10-15',
      buying_price: 100.4446,
      selling_price: 100.4888,
      average_price: 100.4667,
      buying_yield: 7.81,
      selling_yield: 7.59,
      average_yield: 7.70,
      dirty_price: 102.3456,
      excel_source: 'treasury_bonds_quotes.xlsx'
    }
  ];

  const insertSql = `
    INSERT INTO mark_to_market (
      series, isin_number, isin_issuer, maturity_date,
      buying_price, selling_price, average_price,
      buying_yield, selling_yield, average_yield,
      dirty_price, excel_source
    ) VALUES ?
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

  try {
    const values = sampleData.map(item => [
      item.series, item.isin_number, item.isin_issuer, item.maturity_date,
      item.buying_price, item.selling_price, item.average_price,
      item.buying_yield, item.selling_yield, item.average_yield,
      item.dirty_price, item.excel_source
    ]);

    await db.query(insertSql, [values]);
    console.log('✅ Sample mark-to-market data inserted');
  } catch (error) {
    console.error('❌ Error inserting sample data:', error);
  }
};

module.exports = {
  up: async () => {
    await createMarkToMarketTable();
    await insertSampleData();
  },
  down: async () => {
    await db.query('DROP TABLE IF EXISTS mark_to_market');
  }
};