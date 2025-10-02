const db = require('../config/database');
const Gsec = require('../models/gsec');

async function testCouponCashflow() {
  try {
    console.log('Testing coupon cashflow capture...');
    
    // Check if we have any GSEC deals with ISINs
    const [gsecRows] = await db.query(`
      SELECT id, isin, face_value, maturity_date, counterparty
      FROM gsec 
      WHERE transaction_type = 'Buy' 
      AND isin IS NOT NULL 
      AND isin != ''
      LIMIT 1
    `);
    
    if (gsecRows.length === 0) {
      console.log('No GSEC Buy transactions found');
      return;
    }
    
    const deal = gsecRows[0];
    console.log(`Testing with GSEC deal ${deal.id}, ISIN: ${deal.isin}`);
    
    // Test coupon cashflow capture
    const captured = await Gsec.captureCouponCashflow(
      deal.id,
      deal.isin,
      deal.face_value,
      deal.maturity_date,
      deal.counterparty
    );
    
    console.log(`Captured ${captured} coupon cashflow entries`);
    
    // Check cashflow transactions
    const [cashflowRows] = await db.query(`
      SELECT COUNT(*) as count 
      FROM cashflow_transactions 
      WHERE reference_number LIKE 'GSEC-${deal.id}-COUPON%'
    `);
    
    console.log(`Total coupon cashflow entries for deal ${deal.id}: ${cashflowRows[0].count}`);
    
  } catch (error) {
    console.error('Error testing coupon cashflow:', error);
  }
}

testCouponCashflow();
