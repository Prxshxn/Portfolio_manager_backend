module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check and add status column
    const [statusCheck] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM money_market_deals LIKE 'status'"
    );
    if (!statusCheck.length) {
      await queryInterface.addColumn('money_market_deals', 'status', {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: 'pending',
        after: 'remarks'
      });
    }

    // Check and add comment column
    const [commentCheck] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM money_market_deals LIKE 'comment'"
    );
    if (!commentCheck.length) {
      await queryInterface.addColumn('money_market_deals', 'comment', {
        type: Sequelize.TEXT,
        allowNull: true,
        after: 'status'
      });
    }

    // Check and add current_approval_level column
    const [approvalLevelCheck] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM money_market_deals LIKE 'current_approval_level'"
    );
    if (!approvalLevelCheck.length) {
      await queryInterface.addColumn('money_market_deals', 'current_approval_level', {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: 'front_office',
        after: 'comment'
      });
    }

    // Check and add authorized_by column
    const [authorizedByCheck] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM money_market_deals LIKE 'authorized_by'"
    );
    if (!authorizedByCheck.length) {
      await queryInterface.addColumn('money_market_deals', 'authorized_by', {
        type: Sequelize.INTEGER,
        allowNull: true,
        after: 'updated_at'
      });
    }

    // Check and add authorized_at column
    const [authorizedAtCheck] = await queryInterface.sequelize.query(
      "SHOW COLUMNS FROM money_market_deals LIKE 'authorized_at'"
    );
    if (!authorizedAtCheck.length) {
      await queryInterface.addColumn('money_market_deals', 'authorized_at', {
        type: Sequelize.DATE,
        allowNull: true,
        after: 'authorized_by'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('money_market_deals', 'authorized_at');
    await queryInterface.removeColumn('money_market_deals', 'authorized_by');
    await queryInterface.removeColumn('money_market_deals', 'current_approval_level');
    await queryInterface.removeColumn('money_market_deals', 'comment');
    await queryInterface.removeColumn('money_market_deals', 'status');
  }
};

