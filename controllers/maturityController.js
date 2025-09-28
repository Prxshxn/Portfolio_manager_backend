const MaturityController = {
  // Get money market maturities up to a specific date
  getMoneyMarketMaturities: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import the model dynamically to avoid circular dependencies
      const MoneyMarketDeal = require('../models/moneyMarketDealModel');
      
      const maturities = await MoneyMarketDeal.getMaturitiesByDate(selectedDate);
      
      res.json({
        success: true,
        data: maturities,
        message: `Found ${maturities.length} money market deals maturing up to ${date}`
      });

    } catch (error) {
      console.error('Error fetching money market maturities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch money market maturities: ' + error.message
      });
    }
  },

  // Get fixed income GSEC maturities up to a specific date
  getFixedIncomeGsecMaturities: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import the model dynamically to avoid circular dependencies
      const GsecDeal = require('../models/gsec');
      
      const maturities = await GsecDeal.getMaturitiesByDate(selectedDate);
      
      res.json({
        success: true,
        data: maturities,
        message: `Found ${maturities.length} GSEC deals maturing up to ${date}`
      });

    } catch (error) {
      console.error('Error fetching GSEC maturities:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch GSEC maturities: ' + error.message
      });
    }
  },

  // Get maturity summary for both product types
  getMaturitySummary: async (req, res) => {
    try {
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required'
        });
      }

      // Validate date format
      const selectedDate = new Date(date);
      if (isNaN(selectedDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      // Import models dynamically
      const MoneyMarketDeal = require('../models/moneyMarketDealModel');
      const GsecDeal = require('../models/gsec');
      
      // Get maturities for both product types
      const [moneyMarketMaturities, gsecMaturities] = await Promise.all([
        MoneyMarketDeal.getMaturitiesByDate(selectedDate),
        GsecDeal.getMaturitiesByDate(selectedDate)
      ]);

      // Calculate summary statistics
      const summary = {
        moneyMarket: {
          totalDeals: moneyMarketMaturities.length,
          totalPrincipal: moneyMarketMaturities.reduce((sum, deal) => sum + (parseFloat(deal.principal_amount) || 0), 0),
          deals7Days: moneyMarketMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 7;
          }).length,
          deals30Days: moneyMarketMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 30;
          }).length
        },
        gsec: {
          totalDeals: gsecMaturities.length,
          totalFaceValue: gsecMaturities.reduce((sum, deal) => sum + (parseFloat(deal.face_value) || 0), 0),
          deals7Days: gsecMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 7;
          }).length,
          deals30Days: gsecMaturities.filter(deal => {
            const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
            return daysToMaturity <= 30;
          }).length
        },
        total: {
          totalDeals: moneyMarketMaturities.length + gsecMaturities.length,
          totalValue: moneyMarketMaturities.reduce((sum, deal) => sum + (parseFloat(deal.principal_amount) || 0), 0) +
                     gsecMaturities.reduce((sum, deal) => sum + (parseFloat(deal.face_value) || 0), 0)
        }
      };
      
      res.json({
        success: true,
        data: summary,
        message: `Maturity summary for ${date}`
      });

    } catch (error) {
      console.error('Error fetching maturity summary:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch maturity summary: ' + error.message
      });
    }
  }
};

// Create accounting entries for borrowing interest payment with principal reinvestment
async function createBorrowingInterestPaymentPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  // Get account IDs
  const [liabilityAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%liability%' 
    LIMIT 1
  `);
  
  const [interestExpenseAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '9%' AND name LIKE '%interest%expense%' 
    LIMIT 1
  `);
  
  const [interestPayableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%interest%payable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Interest payment entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, interestExpenseAccount[0].id, processDate, interestAmount, `Interest payment for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, interestAmount, `Interest payment from bank for deal ${deal.deal_number}`]);
  
  // Principal reinvestment entries (no bank movement, just internal transfer)
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, liabilityAccount[0].id, processDate, principalAmount, `Principal reinvestment for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestPayableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestPayableAccount[0].id, processDate, interestAmount, `Interest reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for lending interest receipt with principal reinvestment
async function createLendingInterestReceiptPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  // Get account IDs
  const [assetAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%asset%' 
    LIMIT 1
  `);
  
  const [interestReceivedAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%received%' 
    LIMIT 1
  `);
  
  const [interestReceivableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%interest%receivable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Interest receipt entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, interestAmount, `Interest receipt to bank for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, interestReceivedAccount[0].id, processDate, interestAmount, `Interest received for deal ${deal.deal_number}`]);
  
  // Principal reinvestment entries (no bank movement, just internal transfer)
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, assetAccount[0].id, processDate, principalAmount, `Principal reinvestment for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestReceivableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestReceivableAccount[0].id, processDate, interestAmount, `Interest receivable reversal for deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for full reinvestment
async function createFullReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate) {
  // Get account IDs
  const [liabilityAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%liability%' 
    LIMIT 1
  `);
  
  const [assetAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%asset%' 
    LIMIT 1
  `);
  
  const [interestExpenseAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '9%' AND name LIKE '%interest%expense%' 
    LIMIT 1
  `);
  
  const [interestReceivedAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%received%' 
    LIMIT 1
  `);
  
  const totalAmount = principalAmount + interestAmount;
  
  if (deal.deal_direction === 'borrowing') {
    // For borrowing: Close liability, recognize interest expense, prepare for reinvestment
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, liabilityAccount[0].id, processDate, principalAmount, `Principal closure for reinvestment - deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestExpenseAccount[0].id, processDate, interestAmount, `Interest expense for reinvestment - deal ${deal.deal_number}`]);
  } else if (deal.deal_direction === 'lending') {
    // For lending: Close asset, recognize interest income, prepare for reinvestment
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, assetAccount[0].id, processDate, principalAmount, `Asset closure for reinvestment - deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestReceivedAccount[0].id, processDate, interestAmount, `Interest received for reinvestment - deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for different amount reinvestment
async function createDifferentAmountReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate) {
  // This is similar to full reinvestment but would typically involve user-specified amounts
  // For now, we'll use the same logic as full reinvestment
  await createFullReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate);
}

// Extended handlers for maturity handling, processing, and export
MaturityController.getMaturityHandling = async (req, res) => {
  try {
    const { date, type, status } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date parameter is required' });
    }
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const MoneyMarketDeal = require('../models/moneyMarketDealModel');
    const GsecDeal = require('../models/gsec');

    const wantMM = !type || type === 'all' || type === 'money_market';
    const wantGsec = !type || type === 'all' || type === 'gsec';

    const [mmRows, gsecRows] = await Promise.all([
      wantMM ? MoneyMarketDeal.getMaturitiesByDate(date) : Promise.resolve([]),
      wantGsec ? GsecDeal.getMaturitiesByDate(date) : Promise.resolve([])
    ]);

    // Map to common UI shape
    const mmMapped = (mmRows || []).map((row, idx) => ({
      id: row.id || row.deal_number || `mm-${idx}`,
      deal_number: row.deal_number,
      deal_type: 'money_market',
      isin: row.isin || '',
      counterparty: row.counterparty_name || row.counterparty_id,
      face_value: row.principal_amount,
      maturity_date: row.maturity_date,
      days_to_maturity: row.days_to_maturity,
      status: row.deal_status || 'pending'
    }));
    const gsecMapped = (gsecRows || []).map((row, idx) => ({
      id: row.id || row.deal_number || `gsec-${idx}`,
      deal_number: row.deal_number || row.isin || `GSEC-${idx}`,
      deal_type: 'gsec',
      isin: row.isin,
      counterparty: row.counterparty_name || row.counterparty,
      face_value: row.face_value,
      maturity_date: row.maturity_date,
      days_to_maturity: row.days_to_maturity,
      status: row.deal_status || 'pending'
    }));

    let combined = [...mmMapped, ...gsecMapped];

    // Optional status filter
    if (status && status !== 'all') {
      combined = combined.filter(d => (d.status || '').toLowerCase() === status.toLowerCase());
    }

    return res.json({ success: true, data: combined });
  } catch (error) {
    console.error('Error fetching maturity handling data:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.processMaturities = async (req, res) => {
  try {
    const { dealIds, processDate, maturityAction, bankPaymentCode } = req.body || {};
    const userData = req.headers['x-user-data'];
    if (!userData) {
      return res.status(401).json({ success: false, error: 'User data not found' });
    }
    const user = JSON.parse(userData);
    const userId = user.id;

    if (!Array.isArray(dealIds) || dealIds.length === 0) {
      return res.status(400).json({ success: false, error: 'dealIds array is required' });
    }
    if (!maturityAction) {
      return res.status(400).json({ success: false, error: 'maturityAction is required' });
    }

    const db = require('../config/database');
    const connection = await db.pool.getConnection();
    await connection.beginTransaction();

    try {
      const processedDeals = [];
      for (const dealId of dealIds) {
        // Get deal details
        const [dealRows] = await connection.query(`
          SELECT mm.id, mm.deal_number, mm.principal_amount, mm.interest_rate, mm.maturity_date, mm.deal_type
          FROM money_market_deals mm WHERE mm.id = ?
          UNION ALL
          SELECT g.id, g.deal_number, g.face_value as principal_amount, g.yield as interest_rate, g.maturity_date, 'gsec' as deal_type
          FROM gsec g WHERE g.id = ?
        `, [dealId, dealId]);

        if (dealRows.length === 0) {
          throw new Error(`Deal ${dealId} not found`);
        }
        const deal = dealRows[0];
        const principalAmount = parseFloat(deal.principal_amount);
        const interestRate = parseFloat(deal.interest_rate) / 100;
        const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
        const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
        const totalAmount = principalAmount + interestAmount;

        // Create initial maturity processing log entry (front_office level)
        await connection.query(`
          INSERT INTO maturity_processing_log
          (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
           processed_date, processed_by, authorization_level, bank_account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'front_office', ?)
        `, [
          dealId,
          deal.deal_number,
          maturityAction,
          principalAmount,
          interestAmount,
          totalAmount,
          processDate,
          userId,
          null // bank_account_id will be set during approval
        ]);

        processedDeals.push({ dealId, dealNumber: deal.deal_number, maturityAction });
      }

      await connection.commit();
      return res.json({
        success: true,
        message: `Maturity processing initiated for ${processedDeals.length} deals. Awaiting Front Office Verifier approval.`,
        data: processedDeals
      });
  } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error initiating maturity processing:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Check maturity authorization with three-tier system
async function checkMaturityAuthorization(req, dealIds, maturityAction) {
  try {
    // Get user from request headers
    const userData = req.headers['x-user-data'];
    if (!userData) {
      return { authorized: false, message: 'User data not found', requiredLevel: 'back_office_final' };
    }

    const user = JSON.parse(userData);

    // Only final back office (or admin) can post maturity entries
    const isFinal = user?.role === 'back_office_final' || user?.role === 'admin';
    if (!isFinal) {
      return {
        authorized: false,
        message: 'Only Back Office Final (or Admin) can post maturity entries',
        requiredLevel: 'back_office_final'
      };
    }

    // Optionally ensure the user has access to the maturity page if provided
    if (Array.isArray(user.allowed_tabs) && !user.allowed_tabs.includes('maturity')) {
      return {
        authorized: false,
        message: 'User is not allowed to access maturity handling',
        requiredLevel: 'back_office_final'
      };
    }

    return { authorized: true };
  } catch (error) {
    console.error('Error checking maturity authorization:', error);
    return { authorized: false, message: 'Authorization check failed', requiredLevel: 'back_office_final' };
  }
}

// Get required authorization level for maturity action
function getRequiredAuthorizationLevel(maturityAction) {
  switch (maturityAction) {
    case 'principal_interest_full_payment':
      return 3; // Level 3 required; post entries only after final approval
    case 'principal_reinvest_interest_paid':
      return 2; // Level 2 required for principal reinvestment with interest payment
    case 'principal_interest_reinvest':
      return 3; // Level 3 required for full reinvestment with new terms
    case 'different_amount_reinvest':
      return 3; // Level 3 required for different amount reinvestment
    case 'partial_payment':
      return 1; // Level 1 for partial payments
    case 'rollover':
      return 2; // Level 2 for rollovers
    case 'extend':
      return 3; // Level 3 for extensions
    default:
      return 1; // Default to level 1
  }
}

// Get authorization level number
function getAuthorizationLevel(role) {
  switch (role) {
    case 'level1': return 1;
    case 'level2': return 2;
    case 'level3': return 3;
    default: return 0;
  }
}

// Calculate total maturity amount for authorization checks
async function calculateTotalMaturityAmount(dealIds) {
  const db = require('../config/db');
  let totalAmount = 0;
  
  for (const dealId of dealIds) {
    const [dealRows] = await db.query(`
      SELECT principal_amount, interest_rate, maturity_date
      FROM money_market_deals 
      WHERE id = ?
      UNION ALL
      SELECT face_value as principal_amount, yield as interest_rate, maturity_date
      FROM gsec 
      WHERE id = ?
    `, [dealId, dealId]);
    
    if (dealRows.length > 0) {
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      totalAmount += principalAmount + interestAmount;
    }
  }
  
  return totalAmount;
}

// Handle principal and interest full payment maturity action
async function handlePrincipalInterestFullPayment(dealIds, processDate, bankAccountId, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
      `, [dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      const totalAmount = principalAmount + interestAmount;
      
      // Create accounting entries based on deal direction
      if (deal.deal_direction === 'borrowing') {
        // For borrowing: DR Liability Account, DR Interest Expenses, CR Bank Account
        await createBorrowingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      } else if (deal.deal_direction === 'lending') {
        // For lending: DR Bank Account, CR Asset Account, CR Interest Received
        await createLendingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      }
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'principal_interest_full_payment'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1, maturity_action = 'principal_interest_full_payment'
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log maturity processing for authorization tracking
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'principal_interest_full_payment',
        principalAmount, 
        interestAmount, 
        totalAmount,
        processDate,
        user.id,
        'level2',
        bankAccountId
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        principalAmount,
        interestAmount,
        totalAmount
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals with principal and interest full payment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in principal interest full payment:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

// Create accounting entries for borrowing maturity
async function createBorrowingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  const Accounting = require('../models/accountingModel');
  
  // Get account IDs
  const [liabilityAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%liability%' 
    LIMIT 1
  `);
  
  const [interestExpenseAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '9%' AND name LIKE '%interest%expense%' 
    LIMIT 1
  `);
  
  const [interestPayableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '2%' AND name LIKE '%interest%payable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Main maturity entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, liabilityAccount[0].id, processDate, principalAmount, `Maturity - Principal payment for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, interestExpenseAccount[0].id, processDate, interestAmount, `Maturity - Interest expense for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, principalAmount + interestAmount, `Maturity - Bank payment for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestPayableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestPayableAccount[0].id, processDate, interestAmount, `Interest reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
  }
}

// Create accounting entries for lending maturity
async function createLendingMaturityEntries(connection, deal, principalAmount, interestAmount, bankAccountId, processDate) {
  // Get account IDs
  const [assetAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%asset%' 
    LIMIT 1
  `);
  
  const [interestReceivedAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%received%' 
    LIMIT 1
  `);
  
  const [interestReceivableAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '1%' AND name LIKE '%interest%receivable%' 
    LIMIT 1
  `);
  
  const [interestAccrualAccount] = await connection.query(`
    SELECT id FROM chart_of_accounts 
    WHERE account_code LIKE '8%' AND name LIKE '%interest%accrual%' 
    LIMIT 1
  `);
  
  // Main maturity entries
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, ?, 0, 'LKR', ?)
  `, [deal.deal_number, bankAccountId, processDate, principalAmount + interestAmount, `Maturity - Bank receipt for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, assetAccount[0].id, processDate, principalAmount, `Maturity - Asset reduction for deal ${deal.deal_number}`]);
  
  await connection.query(`
    INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
    VALUES (?, ?, ?, 0, ?, 'LKR', ?)
  `, [deal.deal_number, interestReceivedAccount[0].id, processDate, interestAmount, `Maturity - Interest received for deal ${deal.deal_number}`]);
  
  // Reverse accumulated interest
  if (interestReceivableAccount.length > 0 && interestAccrualAccount.length > 0) {
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, 0, ?, 'LKR', ?)
    `, [deal.deal_number, interestAccrualAccount[0].id, processDate, interestAmount, `Interest accrual reversal for deal ${deal.deal_number}`]);
    
    await connection.query(`
      INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
      VALUES (?, ?, ?, ?, 0, 'LKR', ?)
    `, [deal.deal_number, interestReceivableAccount[0].id, processDate, interestAmount, `Interest receivable reversal for deal ${deal.deal_number}`]);
  }
}

// Handle principal reinvestment with interest payment
async function handlePrincipalReinvestInterestPaid(dealIds, processDate, bankAccountId, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
      `, [dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      
      // Create accounting entries for principal reinvestment with interest payment
      if (deal.deal_direction === 'borrowing') {
        // For borrowing: Pay interest, reinvest principal
        await createBorrowingInterestPaymentPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      } else if (deal.deal_direction === 'lending') {
        // For lending: Receive interest, reinvest principal
        await createLendingInterestReceiptPrincipalReinvest(connection, deal, principalAmount, interestAmount, bankAccountId, processDate);
      }
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'principal_reinvest_interest_paid'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1, maturity_action = 'principal_reinvest_interest_paid'
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log processing
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'principal_reinvest_interest_paid',
        principalAmount, 
        interestAmount, 
        interestAmount, // Only interest is paid/received
        processDate,
        user.id,
        'level2',
        bankAccountId
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        principalAmount,
        interestAmount,
        reinvestmentAmount: principalAmount
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals with principal reinvestment and interest payment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in principal reinvest interest paid:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

// Handle full principal and interest reinvestment
async function handlePrincipalInterestReinvest(dealIds, processDate, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
      `, [dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      const totalReinvestmentAmount = principalAmount + interestAmount;
      
      // Create accounting entries for full reinvestment
      await createFullReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate);
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'principal_interest_reinvest'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1, maturity_action = 'principal_interest_reinvest'
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log processing
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'principal_interest_reinvest',
        principalAmount, 
        interestAmount, 
        totalReinvestmentAmount,
        processDate,
        user.id,
        'level3',
        null
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        principalAmount,
        interestAmount,
        totalReinvestmentAmount
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals with full principal and interest reinvestment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in principal interest reinvest:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

// Handle different amount reinvestment
async function handleDifferentAmountReinvest(dealIds, processDate, res) {
  const db = require('../config/db');
  const connection = await db.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const processedDeals = [];
    
    for (const dealId of dealIds) {
      // Get deal details
      const [dealRows] = await connection.query(`
        SELECT 
          mm.id, mm.deal_number, mm.deal_type, mm.principal_amount, mm.interest_rate,
          mm.maturity_date, mm.counterparty_id, mm.isin,
          c.name as counterparty_name,
          mm.deal_direction
        FROM money_market_deals mm
        LEFT JOIN counterparties c ON mm.counterparty_id = c.id
        WHERE mm.id = ?
        UNION ALL
        SELECT 
          g.id, g.deal_number, 'gsec' as deal_type, g.face_value as principal_amount, g.yield as interest_rate,
          g.maturity_date, g.counterparty_id, g.isin,
          c.name as counterparty_name,
          g.deal_direction
        FROM gsec g
        LEFT JOIN counterparties c ON g.counterparty_id = c.id
        WHERE g.id = ?
      `, [dealId, dealId]);
      
      if (dealRows.length === 0) {
        throw new Error(`Deal ${dealId} not found`);
      }
      
      const deal = dealRows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      const daysToMaturity = Math.ceil((new Date(deal.maturity_date) - new Date()) / (1000 * 60 * 60 * 24));
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      
      // For different amount reinvestment, we need additional parameters
      // This would typically require user input for the new amount
      // For now, we'll process as a standard reinvestment
      await createDifferentAmountReinvestmentEntries(connection, deal, principalAmount, interestAmount, processDate);
      
      // Mark deal as processed and matured on the correct table
      if (deal.deal_type === 'gsec') {
        await connection.query(`
          UPDATE gsec 
          SET matured = 1, maturity_action = 'different_amount_reinvest'
          WHERE id = ?
        `, [dealId]);
      } else {
        await connection.query(`
          UPDATE money_market_deals 
          SET matured = 1, maturity_action = 'different_amount_reinvest'
          WHERE id = ?
        `, [dealId]);
      }
      
      // Log processing
      const userData = req.headers['x-user-data'];
      const user = userData ? JSON.parse(userData) : { id: null };
      
      await connection.query(`
        INSERT INTO maturity_processing_log 
        (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount, 
         processed_date, processed_by, authorization_level, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dealId, 
        deal.deal_number, 
        'different_amount_reinvest',
        principalAmount, 
        interestAmount, 
        principalAmount + interestAmount, // This would be the new amount
        processDate,
        user.id,
        'level3',
        null
      ]);
      
      processedDeals.push({
        dealId,
        dealNumber: deal.deal_number,
        originalAmount: principalAmount + interestAmount,
        reinvestmentAmount: principalAmount + interestAmount, // This would be user-specified
        note: 'Different amount reinvestment - requires manual deal creation'
      });
    }
    
    await connection.commit();
    
    return res.json({
      success: true,
      message: `Successfully processed ${processedDeals.length} deals for different amount reinvestment`,
      data: processedDeals
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error in different amount reinvest:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
}

MaturityController.getBankAccounts = async (req, res) => {
  try {
    const db = require('../config/database');
    
    // Get bank accounts from chart of accounts
    const [bankAccounts] = await db.query(`
      SELECT id, account_code, name, account_type_id
      FROM chart_of_accounts 
      WHERE account_code LIKE '1%' 
        AND (name LIKE '%bank%' OR name LIKE '%cash%')
        AND is_active = TRUE
      ORDER BY account_code
    `);
    
    return res.json({
      success: true,
      data: bankAccounts,
      message: `Found ${bankAccounts.length} bank accounts`
    });
  } catch (error) {
    console.error('Error fetching bank accounts:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.getMaturityProcessingHistory = async (req, res) => {
  try {
    const db = require('../config/database');
    const { startDate, endDate, userId, authorizationLevel } = req.query;
    
    let query = `
      SELECT mpl.*, u.username as processed_by_name
      FROM maturity_processing_log mpl
      LEFT JOIN users u ON mpl.processed_by = u.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (startDate) {
      query += ` AND mpl.processed_date >= ?`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND mpl.processed_date <= ?`;
      params.push(endDate);
    }
    
    if (userId) {
      query += ` AND mpl.processed_by = ?`;
      params.push(userId);
    }
    
    if (authorizationLevel) {
      query += ` AND mpl.authorization_level = ?`;
      params.push(authorizationLevel);
    }
    
    query += ` ORDER BY mpl.processed_date DESC, mpl.created_at DESC`;
    
    const [history] = await db.query(query, params);
    
    return res.json({
      success: true,
      data: history,
      message: `Found ${history.length} maturity processing records`
    });
  } catch (error) {
    console.error('Error fetching maturity processing history:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

MaturityController.exportMaturities = async (req, res) => {
  try {
    const { date, type, status, format = 'excel' } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date parameter is required' });
    }
    const selectedDate = new Date(date);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const MoneyMarketDeal = require('../models/moneyMarketDealModel');
    const GsecDeal = require('../models/gsec');

    const wantMM = !type || type === 'all' || type === 'money_market';
    const wantGsec = !type || type === 'all' || type === 'gsec';

    const [mmRows, gsecRows] = await Promise.all([
      wantMM ? MoneyMarketDeal.getMaturitiesByDate(date) : Promise.resolve([]),
      wantGsec ? GsecDeal.getMaturitiesByDate(date) : Promise.resolve([])
    ]);
    // Map to exportable shape; reusing UI mapping keys where applicable
    let combined = [
      ...(mmRows || []).map((row, idx) => ({
        portfolio: '',
        custodian: '',
        deal_number: row.deal_number,
        face_value: row.principal_amount,
        value_date: row.value_date || '',
        maturity_date: row.maturity_date,
        isin: row.isin || '',
        coupon_interest: '',
        clean_price: '',
        nvp: '',
        yield: '',
        dtm: row.days_to_maturity,
        balance: row.principal_amount,
        available_balance: row.principal_amount,
        wap: '',
        repo_collateral: '',
        sell_back: '',
        counterparty: row.counterparty_name || row.counterparty_id
      })),
      ...(gsecRows || []).map((row, idx) => ({
        portfolio: row.portfolio || '',
        custodian: row.custodian || '',
        deal_number: row.deal_number || '',
        face_value: row.face_value,
        value_date: row.value_date || '',
        maturity_date: row.maturity_date,
        isin: row.isin,
        coupon_interest: row.coupon_interest || '',
        clean_price: row.clean_price || '',
        nvp: '',
        yield: row.yield || '',
        dtm: row.days_to_maturity,
        balance: row.face_value,
        available_balance: row.face_value,
        wap: '',
        repo_collateral: '',
        sell_back: '',
        counterparty: row.counterparty_name || row.counterparty
      }))
    ];
    if (status && status !== 'all') {
      // No status field in export rows; skip filter or map if available
    }
    const exporter = require('../utils/reportExporter');
    const buf = await exporter.export(format, combined);
    const mime = exporter.getMimeType(format);
    res.setHeader('Content-Type', mime);
    const dateStr = String(date);
    res.setHeader('Content-Disposition', `attachment; filename="maturity-handling-${dateStr}.${format === 'excel' ? 'xlsx' : format === 'csv' ? 'csv' : 'pdf'}"`);
    return res.status(200).send(buf);
  } catch (error) {
    console.error('Error exporting maturities:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = MaturityController;
 
// --- Maturity Blotter helpers (3-tier flow like GSEC) ---
// List pending maturities for blotters by role
MaturityController.getMaturityBlotter = async (req, res) => {
  try {
    const db = require('../config/database');
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // Determine requester role from header
    const userData = req.headers['x-user-data'];
    const user = userData ? JSON.parse(userData) : {};
    const role = user.role;

    // Role-based filtering for the 3-tier approval flow
    let filterSql = '';
    if (role === 'front_office') {
      // Front office sees deals they initiated (authorization_level = 'front_office')
      filterSql = `mpl.authorization_level = 'front_office'`;
    } else if (role === 'back_office_verifier') {
      // Verifier sees deals that Front Office has approved (authorization_level = 'back_office_verifier')
      // These are ready for verifier approval
      filterSql = `mpl.authorization_level = 'back_office_verifier'`;
    } else {
      // back_office_final or admin: sees deals that Verifier has approved (authorization_level = 'back_office_final')
      // These are ready for final approval
      filterSql = `mpl.authorization_level = 'back_office_final'`;
    }

    const [rows] = await db.query(`
      SELECT DISTINCT
        mpl.deal_id,
        mpl.deal_number,
        mpl.maturity_action,
        mpl.processed_date AS first_logged_date,
        CASE mpl.authorization_level 
          WHEN 'front_office' THEN 1 
          WHEN 'back_office_verifier' THEN 2 
          WHEN 'back_office_final' THEN 3 
          ELSE 0 END AS current_stage
      FROM maturity_processing_log mpl
      LEFT JOIN money_market_deals mm ON mpl.deal_id = mm.id
      LEFT JOIN gsec g ON mpl.deal_id = g.id
      WHERE mpl.processed_date <= ?
        AND ${filterSql}
        -- Exclude deals that are already matured
        AND COALESCE(mm.matured, g.matured, 0) = 0
      ORDER BY mpl.processed_date DESC, mpl.deal_id DESC
    `, [targetDate]);

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching maturity blotter:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Approve maturities per role; only final posts entries
MaturityController.approveMaturities = async (req, res) => {
  try {
    const { dealIds, processDate, maturityAction, bankPaymentCode, bankAccountId } = req.body || {};
    if (!Array.isArray(dealIds) || dealIds.length === 0) {
      return res.status(400).json({ success: false, error: 'dealIds array is required' });
    }
    if (!maturityAction) {
      return res.status(400).json({ success: false, error: 'maturityAction is required' });
    }

    // Role from user header
    const userData = req.headers['x-user-data'];
    const user = userData ? JSON.parse(userData) : null;
    const role = user?.role;
    if (!role) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Non-final roles update the existing log record with new authorization level
    if (role === 'front_office' || role === 'back_office_verifier') {
      const db = require('../config/database');
      const today = processDate || new Date().toISOString().slice(0, 10);
      
      for (const id of dealIds) {
        // Check if record exists for this deal and maturity action
        const [existing] = await db.query(`
          SELECT id FROM maturity_processing_log 
          WHERE deal_id = ? AND maturity_action = ?
          ORDER BY created_at DESC LIMIT 1
        `, [id, maturityAction]);
        
        if (existing.length > 0) {
          // Update existing record with next authorization level
          let nextLevel = '';
          if (role === 'front_office') {
            nextLevel = 'back_office_verifier'; // Front Office approval moves to Verifier
          } else if (role === 'back_office_verifier') {
            nextLevel = 'back_office_final'; // Verifier approval moves to Final
          }
          
          await db.query(`
            UPDATE maturity_processing_log 
            SET authorization_level = ?, processed_by = ?, processed_date = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [nextLevel, user.id, today, existing[0].id]);
        } else {
          // Create new record if none exists (shouldn't happen in normal flow)
          await db.query(`
            INSERT INTO maturity_processing_log
            (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
             processed_date, processed_by, authorization_level, bank_account_id)
            VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, NULL)
          `, [id, String(id), maturityAction, today, user.id, role]);
        }
      }
      return res.json({ success: true, message: `Updated ${role} authorization for ${dealIds.length} deals` });
    }

    // Final role triggers posting using existing handler
    if (role === 'back_office_final' || role === 'admin') {
      // Reuse processMaturities flow to post entries; fabricate req/res minimal
      req.body = { dealIds, processDate, maturityAction, bankPaymentCode, bankAccountId };
      return await MaturityController.processMaturities(req, res);
    }

    return res.status(403).json({ success: false, error: 'Role not allowed' });
  } catch (error) {
    console.error('Error approving maturities:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};