const createRepoDealsTable = require('../migrations/20250101-create-repo-deals-table');

console.log('🚀 Starting repo deals table migration...');

createRepoDealsTable()
  .then(() => {
    console.log('✅ Migration completed successfully!');
    console.log('📊 repo_deals table is now ready for use');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
