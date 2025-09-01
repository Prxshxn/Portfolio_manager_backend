const db = require('../config/db');

const createRepoDealsTable = async () => {
  try {
          const sql = `
        CREATE TABLE IF NOT EXISTS repo_deals (
          id INT AUTO_INCREMENT PRIMARY KEY,
          deal_type ENUM('Repo', 'Reverse Repo') NOT NULL,
          counterparty_id INT NOT NULL,
          
          trade_date DATE NOT NULL,
          value_date DATE NOT NULL,
          maturity_date DATE NOT NULL,
          principal_amount DECIMAL(20,4) NOT NULL,
          interest_amount DECIMAL(20,4) NOT NULL,
          rate DECIMAL(10,4) NOT NULL,
          maturity_amount DECIMAL(20,4) NOT NULL,
          tenor INT NOT NULL,
          calculation_day_basis INT NOT NULL DEFAULT 365,
          isin_number VARCHAR(50) NOT NULL,
          issue_date VARCHAR(20),
          haircut DECIMAL(5,2) DEFAULT 0.00,
          face_value DECIMAL(20,4),
          status ENUM('Pending', 'Active', 'Matured', 'Cancelled') DEFAULT 'Pending',
          created_by INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_deal_type (deal_type),
                     INDEX idx_counterparty (counterparty_id),
          INDEX idx_trade_date (trade_date),
          INDEX idx_maturity_date (maturity_date),
          INDEX idx_status (status),
          INDEX idx_isin (isin_number)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `;

    await db.query(sql);
    console.log('✅ repo_deals table created successfully');
    
    // Add some sample data for testing
    const sampleData = [
      {
                 deal_type: 'Repo',
         counterparty_id: 1,
         trade_date: '2025-01-15',
        value_date: '2025-01-16',
        maturity_date: '2025-02-15',
        principal_amount: 1000000.00,
        interest_amount: 12328.77,
        rate: 6.50,
        maturity_amount: 1012328.77,
        tenor: 30,
        calculation_day_basis: 365,
        isin_number: 'IN1234567890',
        issue_date: '15/01/2025',
        haircut: 2.50,
        face_value: 1000000.00,
        status: 'Active',
        created_by: 1
      },
      {
                 deal_type: 'Reverse Repo',
         counterparty_id: 1,
         trade_date: '2025-01-20',
        value_date: '2025-01-21',
        maturity_date: '2025-03-20',
        principal_amount: 500000.00,
        interest_amount: 16438.36,
        rate: 7.25,
        maturity_amount: 516438.36,
        tenor: 58,
        calculation_day_basis: 365,
        isin_number: 'IN0987654321',
        issue_date: '20/01/2025',
        haircut: 1.75,
        face_value: 500000.00,
        status: 'Active',
        created_by: 1
      }
    ];

    for (const deal of sampleData) {
      const insertSql = `
                 INSERT INTO repo_deals (
           deal_type, counterparty_id, trade_date, value_date, maturity_date,
           principal_amount, interest_amount, rate, maturity_amount, tenor,
           calculation_day_basis, isin_number, issue_date, haircut, face_value,
           status, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
             await db.query(insertSql, [
         deal.deal_type, deal.counterparty_id, deal.trade_date, deal.value_date, deal.maturity_date,
         deal.principal_amount, deal.interest_amount, deal.rate, deal.maturity_amount, deal.tenor,
         deal.calculation_day_basis, deal.isin_number, deal.issue_date, deal.haircut, deal.face_value,
         deal.status, deal.created_by
       ]);
    }
    
    console.log('✅ Sample repo deals data inserted successfully');
    
  } catch (error) {
    console.error('❌ Error creating repo_deals table:', error);
    throw error;
  }
};

// Run the migration if this file is executed directly
if (require.main === module) {
  createRepoDealsTable()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = createRepoDealsTable;
