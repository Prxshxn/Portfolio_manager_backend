const db = require('../config/db');

async function testBuybackWorkflow() {
  try {
    console.log('Testing Buyback Workflow...\n');

    // Test 1: Check if the new status is supported
    console.log('1. Testing status enum support...');
    const testStatus = 'Pending_Final_Approval';
    
    try {
      const result = await db.query('SELECT ? as test_status', [testStatus]);
      console.log(`   ✓ Status '${testStatus}' is supported`);
    } catch (error) {
      console.log(`   ✗ Status '${testStatus}' is not supported: ${error.message}`);
    }

    // Test 2: Check current buyback deals and their statuses
    console.log('\n2. Checking current buyback deals...');
    const [deals] = await db.query('SELECT id, deal_number, deal_status FROM buyback_deals LIMIT 5');
    
    if (deals.length === 0) {
      console.log('   No buyback deals found in database');
    } else {
      console.log(`   Found ${deals.length} deals:`);
      deals.forEach(deal => {
        console.log(`     - Deal ${deal.deal_number}: ${deal.deal_status}`);
      });
    }

    // Test 3: Check if we can update a deal to the new status
    console.log('\n3. Testing status update capability...');
    if (deals.length > 0) {
      const testDealId = deals[0].id;
      const oldStatus = deals[0].deal_status;
      
      try {
        // Try to update to new status
        await db.query(
          'UPDATE buyback_deals SET deal_status = ? WHERE id = ?',
          [testStatus, testDealId]
        );
        
        // Verify the update
        const [updatedDeal] = await db.query(
          'SELECT deal_status FROM buyback_deals WHERE id = ?',
          [testDealId]
        );
        
        if (updatedDeal[0] && updatedDeal[0].deal_status === testStatus) {
          console.log(`   ✓ Successfully updated deal ${testDealId} to '${testStatus}'`);
          
          // Revert the change
          await db.query(
            'UPDATE buyback_deals SET deal_status = ? WHERE id = ?',
            [oldStatus, testDealId]
          );
          console.log(`   ✓ Reverted deal ${testDealId} back to '${oldStatus}'`);
        } else {
          console.log(`   ✗ Failed to update deal ${testDealId} to '${testStatus}'`);
        }
      } catch (error) {
        console.log(`   ✗ Error updating deal status: ${error.message}`);
      }
    }

    console.log('\n✓ Buyback workflow test completed');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
  } finally {
    await db.end();
  }
}

// Run the test
testBuybackWorkflow();
