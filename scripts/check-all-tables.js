const db = require('../config/database');

// Expected tables list (all tables that should exist)
const expectedTables = [
  'account_mappings',
  'account_types',
  'accounts',
  'authorizer_assignments',
  'balance_impact_log',
  'brokers',
  'buyback_deals',
  'cashflow_categories',
  'cashflow_projections',
  'cashflow_reconciliation',
  'cashflow_transactions',
  'chart_of_accounts',
  'counterparties',
  'counterparty_limits',
  'counterparty_master_corporate',
  'counterparty_master_individual',
  'counterparty_master_joint',
  'fixed_deposit_requests',
  'fund_centre_master',
  'gsec',
  'gsec_sell_deal',
  'gsec_sell_record',
  'holiday_calendar',
  'isin_coupon_schedule',
  'isin_master',
  'joint_counterparty_relationships',
  'ledger_entries',
  'mark_to_market',
  'maturity_processing_log',
  'money_market_deals',
  'payment_masters',
  'portfolio_master',
  'repo_deal_isins',
  'repo_deals',
  'securities',
  'settlement_accounts',
  'strategy_master',
  'system_day',
  'tbill',
  'transaction_types',
  'transactions',
  'users',
  'webhook_logs',
  'webhook_queue'
];

async function checkAllTables() {
  try {
    console.log('\n=== Checking Database Tables ===\n');
    
    // Get all tables from database
    const [tables] = await db.query('SHOW TABLES');
    const existingTables = tables.map(t => Object.values(t)[0]).sort();
    
    console.log(`Found ${existingTables.length} tables in database\n`);
    
    // Check which expected tables are present
    const presentTables = [];
    const missingTables = [];
    
    expectedTables.forEach(table => {
      if (existingTables.includes(table)) {
        presentTables.push(table);
      } else {
        missingTables.push(table);
      }
    });
    
    // Check for unexpected tables (tables in DB but not in expected list)
    const unexpectedTables = existingTables.filter(t => !expectedTables.includes(t));
    
    // Display results
    console.log(`✅ Present Tables: ${presentTables.length}/${expectedTables.length}`);
    presentTables.forEach(t => console.log(`   ✓ ${t}`));
    
    if (missingTables.length > 0) {
      console.log(`\n❌ Missing Tables: ${missingTables.length}`);
      missingTables.forEach(t => console.log(`   ✗ ${t}`));
    } else {
      console.log(`\n✅ All expected tables are present!`);
    }
    
    if (unexpectedTables.length > 0) {
      console.log(`\n⚠️  Unexpected Tables (not in expected list): ${unexpectedTables.length}`);
      unexpectedTables.forEach(t => console.log(`   ? ${t}`));
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Total expected: ${expectedTables.length}`);
    console.log(`Total present: ${presentTables.length}`);
    console.log(`Total missing: ${missingTables.length}`);
    console.log(`Total in database: ${existingTables.length}`);
    
    if (missingTables.length === 0) {
      console.log(`\n✅ All tables are present!`);
    } else {
      console.log(`\n⚠️  ${missingTables.length} table(s) are missing.`);
    }
    
  } catch (error) {
    console.error('Error checking tables:', error);
  } finally {
    process.exit();
  }
}

checkAllTables();
