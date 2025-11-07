module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if trade_date column already exists
    const [results] = await queryInterface.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'gsec' 
      AND COLUMN_NAME = 'trade_date'
    `);
    
    // Only add the column if it doesn't exist
    if (results.length === 0) {
      await queryInterface.addColumn('gsec', 'trade_date', {
        type: Sequelize.DATEONLY,
        allowNull: true,
        comment: 'Trade date for the GSec transaction'
      });
      console.log('Added trade_date column to gsec table');
    } else {
      console.log('trade_date column already exists in gsec table');
    }
  },
  
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('gsec', 'trade_date');
  }
};

