const db = require('../config/database');

class CashflowCaptureService {
  // Capture cashflow from maturity processing (when authorization_level = 'back_office_final')
  static async captureMaturityCashflow(dealId, productType, maturityAction, maturityAmount, maturityDate) {
    try {
      console.log(`Capturing maturity cashflow for ${productType} deal ${dealId}`);
      
      // Get cashflow categories
      const [categories] = await db.query(`
        SELECT id, name, type FROM cashflow_categories WHERE is_active = TRUE
      `);
      
      const categoryMap = {};
      categories.forEach(cat => {
        categoryMap[cat.name.toLowerCase()] = cat;
      });
      
      let cashflowEntries = [];
      
      if (maturityAction === 'full_payment') {
        // Full payment - cash inflow
        const interestCategory = categoryMap['interest income'];
        const principalCategory = categoryMap['investment sales'];
        
        if (interestCategory) {
          cashflowEntries.push({
            category_id: interestCategory.id,
            transaction_date: maturityDate,
            amount: maturityAmount,
            flow_type: 'inflow',
            currency: 'LKR',
            description: `Maturity payment - ${productType.toUpperCase()} Deal ${dealId}`,
            reference_number: `${productType.toUpperCase()}-${dealId}`,
            counterparty: 'Maturity Processing',
            status: 'confirmed'
          });
        }
        
        if (principalCategory) {
          cashflowEntries.push({
            category_id: principalCategory.id,
            transaction_date: maturityDate,
            amount: maturityAmount,
            flow_type: 'inflow',
            currency: 'LKR',
            description: `Principal return - ${productType.toUpperCase()} Deal ${dealId}`,
            reference_number: `${productType.toUpperCase()}-${dealId}`,
            counterparty: 'Maturity Processing',
            status: 'confirmed'
          });
        }
      } else if (maturityAction === 'principal_reinvest_interest_paid') {
        // Principal reinvested, interest paid - interest inflow
        const interestCategory = categoryMap['interest income'];
        
        if (interestCategory) {
          cashflowEntries.push({
            category_id: interestCategory.id,
            transaction_date: maturityDate,
            amount: maturityAmount,
            flow_type: 'inflow',
            currency: 'LKR',
            description: `Interest payment - ${productType.toUpperCase()} Deal ${dealId}`,
            reference_number: `${productType.toUpperCase()}-${dealId}`,
            counterparty: 'Maturity Processing',
            status: 'confirmed'
          });
        }
      } else if (maturityAction === 'principal_interest_reinvest') {
        // Both reinvested - no immediate cashflow, but track as investment
        const investmentCategory = categoryMap['investment purchases'];
        
        if (investmentCategory) {
          cashflowEntries.push({
            category_id: investmentCategory.id,
            transaction_date: maturityDate,
            amount: maturityAmount,
            flow_type: 'outflow',
            currency: 'LKR',
            description: `Reinvestment - ${productType.toUpperCase()} Deal ${dealId}`,
            reference_number: `${productType.toUpperCase()}-${dealId}`,
            counterparty: 'Maturity Processing',
            status: 'confirmed'
          });
        }
      }
      
      // Insert cashflow entries
      for (const entry of cashflowEntries) {
        await db.query(`
          INSERT INTO cashflow_transactions 
          (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          entry.category_id,
          entry.transaction_date,
          entry.amount,
          entry.flow_type,
          entry.currency,
          entry.description,
          entry.reference_number,
          entry.counterparty,
          entry.status
        ]);
      }
      
      console.log(`Captured ${cashflowEntries.length} cashflow entries for maturity`);
      return cashflowEntries.length;
      
    } catch (error) {
      console.error('Error capturing maturity cashflow:', error);
      throw error;
    }
  }

  // Capture cashflow from GSEC transactions
  static async captureGsecCashflow(dealId, transactionType, amount, transactionDate, counterparty) {
    try {
      console.log(`Capturing GSEC cashflow for deal ${dealId}, type: ${transactionType}`);
      
      const [categories] = await db.query(`
        SELECT id, name, type FROM cashflow_categories WHERE is_active = TRUE
      `);
      
      const categoryMap = {};
      categories.forEach(cat => {
        categoryMap[cat.name.toLowerCase()] = cat;
      });
      
      let cashflowEntries = [];
      
      if (transactionType === 'buy' || transactionType === 'purchase') {
        // GSEC purchase - cash outflow
        const investmentCategory = categoryMap['investment purchases'];
        
        if (investmentCategory) {
          cashflowEntries.push({
            category_id: investmentCategory.id,
            transaction_date: transactionDate,
            amount: amount,
            flow_type: 'outflow',
            currency: 'LKR',
            description: `GSEC Purchase - Deal ${dealId}`,
            reference_number: `GSEC-${dealId}`,
            counterparty: counterparty,
            status: 'confirmed'
          });
        }
      } else if (transactionType === 'sell' || transactionType === 'sale') {
        // GSEC sale - cash inflow
        const investmentCategory = categoryMap['investment sales'];
        
        if (investmentCategory) {
          cashflowEntries.push({
            category_id: investmentCategory.id,
            transaction_date: transactionDate,
            amount: amount,
            flow_type: 'inflow',
            currency: 'LKR',
            description: `GSEC Sale - Deal ${dealId}`,
            reference_number: `GSEC-${dealId}`,
            counterparty: counterparty,
            status: 'confirmed'
          });
        }
      }
      
      // Insert cashflow entries
      for (const entry of cashflowEntries) {
        await db.query(`
          INSERT INTO cashflow_transactions 
          (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          entry.category_id,
          entry.transaction_date,
          entry.amount,
          entry.flow_type,
          entry.currency,
          entry.description,
          entry.reference_number,
          entry.counterparty,
          entry.status
        ]);
      }
      
      console.log(`Captured ${cashflowEntries.length} cashflow entries for GSEC`);
      return cashflowEntries.length;
      
    } catch (error) {
      console.error('Error capturing GSEC cashflow:', error);
      throw error;
    }
  }

  // Capture cashflow from Repo transactions
  static async captureRepoCashflow(dealNumber, transactionType, amount, transactionDate, counterparty) {
    try {
      console.log(`Capturing Repo cashflow for deal ${dealNumber}, type: ${transactionType}`);
      
      const [categories] = await db.query(`
        SELECT id, name, type FROM cashflow_categories WHERE is_active = TRUE
      `);
      
      const categoryMap = {};
      categories.forEach(cat => {
        categoryMap[cat.name.toLowerCase()] = cat;
      });
      
      let cashflowEntries = [];
      
      if (transactionType === 'repo_in' || transactionType === 'lending') {
        // Repo lending - cash outflow
        const investmentCategory = categoryMap['investment purchases'];
        
        if (investmentCategory) {
          cashflowEntries.push({
            category_id: investmentCategory.id,
            transaction_date: transactionDate,
            amount: amount,
            flow_type: 'outflow',
            currency: 'LKR',
            description: `Repo Lending - Deal ${dealNumber}`,
            reference_number: dealNumber,
            counterparty: counterparty,
            status: 'confirmed'
          });
        }
      } else if (transactionType === 'repo_out' || transactionType === 'borrowing') {
        // Repo borrowing - cash inflow
        const borrowingCategory = categoryMap['borrowings'];
        
        if (borrowingCategory) {
          cashflowEntries.push({
            category_id: borrowingCategory.id,
            transaction_date: transactionDate,
            amount: amount,
            flow_type: 'inflow',
            currency: 'LKR',
            description: `Repo Borrowing - Deal ${dealNumber}`,
            reference_number: dealNumber,
            counterparty: counterparty,
            status: 'confirmed'
          });
        }
      }
      
      // Insert cashflow entries
      for (const entry of cashflowEntries) {
        await db.query(`
          INSERT INTO cashflow_transactions 
          (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          entry.category_id,
          entry.transaction_date,
          entry.amount,
          entry.flow_type,
          entry.currency,
          entry.description,
          entry.reference_number,
          entry.counterparty,
          entry.status
        ]);
      }
      
      console.log(`Captured ${cashflowEntries.length} cashflow entries for Repo`);
      return cashflowEntries.length;
      
    } catch (error) {
      console.error('Error capturing Repo cashflow:', error);
      throw error;
    }
  }

  // Capture cashflow from Money Market transactions
  static async captureMoneyMarketCashflow(dealId, transactionType, amount, transactionDate, counterparty) {
    try {
      console.log(`Capturing Money Market cashflow for deal ${dealId}, type: ${transactionType}`);
      
      const [categories] = await db.query(`
        SELECT id, name, type FROM cashflow_categories WHERE is_active = TRUE
      `);
      
      const categoryMap = {};
      categories.forEach(cat => {
        categoryMap[cat.name.toLowerCase()] = cat;
      });
      
      let cashflowEntries = [];
      
      if (transactionType === 'lending' || transactionType === 'investment') {
        // Money Market lending - cash outflow
        const investmentCategory = categoryMap['investment purchases'];
        
        if (investmentCategory) {
          cashflowEntries.push({
            category_id: investmentCategory.id,
            transaction_date: transactionDate,
            amount: amount,
            flow_type: 'outflow',
            currency: 'LKR',
            description: `Money Market Lending - Deal ${dealId}`,
            reference_number: `MM-${dealId}`,
            counterparty: counterparty,
            status: 'confirmed'
          });
        }
      } else if (transactionType === 'borrowing') {
        // Money Market borrowing - cash inflow
        const borrowingCategory = categoryMap['borrowings'];
        
        if (borrowingCategory) {
          cashflowEntries.push({
            category_id: borrowingCategory.id,
            transaction_date: transactionDate,
            amount: amount,
            flow_type: 'inflow',
            currency: 'LKR',
            description: `Money Market Borrowing - Deal ${dealId}`,
            reference_number: `MM-${dealId}`,
            counterparty: counterparty,
            status: 'confirmed'
          });
        }
      }
      
      // Insert cashflow entries
      for (const entry of cashflowEntries) {
        await db.query(`
          INSERT INTO cashflow_transactions 
          (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          entry.category_id,
          entry.transaction_date,
          entry.amount,
          entry.flow_type,
          entry.currency,
          entry.description,
          entry.reference_number,
          entry.counterparty,
          entry.status
        ]);
      }
      
      console.log(`Captured ${cashflowEntries.length} cashflow entries for Money Market`);
      return cashflowEntries.length;
      
    } catch (error) {
      console.error('Error capturing Money Market cashflow:', error);
      throw error;
    }
  }

  // Auto-capture cashflow from existing transactions
  static async autoCaptureExistingTransactions() {
    try {
      console.log('Auto-capturing cashflow from existing transactions...');
      
      let totalCaptured = 0;
      
      // Capture from maturity processing log (final approvals)
      const [maturityRows] = await db.query(`
        SELECT mpl.deal_id, mpl.maturity_action, mpl.total_amount, mpl.processed_date
        FROM maturity_processing_log mpl
        WHERE mpl.authorization_level = 'back_office_final'
        AND mpl.processed_date <= CURDATE()
      `);
      
      for (const row of maturityRows) {
        // Infer product type by probing deal tables
        let productType = 'money_market';
        let found = false;
        try {
          const [mm] = await db.query('SELECT id FROM money_market_deals WHERE id = ? LIMIT 1', [row.deal_id]);
          if (mm.length) { productType = 'money_market'; found = true; }
        } catch (_) {}
        if (!found) {
          try {
            const [g] = await db.query('SELECT id FROM gsec WHERE id = ? LIMIT 1', [row.deal_id]);
            if (g.length) { productType = 'gsec'; found = true; }
          } catch (_) {}
        }
        if (!found) {
          try {
            const [r] = await db.query('SELECT id FROM repo_deals WHERE id = ? LIMIT 1', [row.deal_id]);
            if (r.length) { productType = 'repo'; found = true; }
          } catch (_) {}
        }

        const captured = await this.captureMaturityCashflow(
          row.deal_id,
          productType,
          row.maturity_action,
          row.total_amount,
          row.processed_date
        );
        totalCaptured += captured;
      }
      
      // Capture from GSEC transactions
      const [gsecRows] = await db.query(`
        SELECT g.id, g.deal_number, g.settlement_amount, g.value_date, g.counterparty_id
        FROM gsec g
        WHERE g.value_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND g.settlement_amount > 0
      `);
      
      for (const row of gsecRows) {
        const captured = await this.captureGsecCashflow(
          row.id,
          'buy', // Assuming all GSEC entries are purchases
          row.settlement_amount,
          row.value_date,
          row.counterparty_id
        );
        totalCaptured += captured;
      }
      
      // Capture from Repo transactions
      const [repoRows] = await db.query(`
        SELECT rd.id, rd.deal_number, rd.deal_type, rd.principal_amount, rd.trade_date, rd.counterparty_id
        FROM repo_deals rd
        WHERE rd.trade_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND rd.principal_amount > 0
      `);
      
      for (const row of repoRows) {
        const captured = await this.captureRepoCashflow(
          row.deal_number || String(row.id),
          row.deal_type === 'Reverse Repo' ? 'repo_in' : 'borrowing',
          row.principal_amount,
          row.trade_date,
          row.counterparty_id
        );
        totalCaptured += captured;
      }
      
      // Capture from Money Market transactions
      const [mmRows] = await db.query(`
        SELECT mmd.id, mmd.principal_amount, mmd.trade_date, mmd.counterparty_id
        FROM money_market_deals mmd
        WHERE mmd.trade_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND mmd.principal_amount > 0
      `);
      
      for (const row of mmRows) {
        const captured = await this.captureMoneyMarketCashflow(
          row.id,
          'lending', // Assuming money market deals are lending
          row.principal_amount,
          row.trade_date,
          row.counterparty_id
        );
        totalCaptured += captured;
      }
      
      console.log(`Auto-captured ${totalCaptured} cashflow entries from existing transactions`);
      return { totalCaptured, maturityRows: maturityRows.length, gsecRows: gsecRows.length, repoRows: repoRows.length, mmRows: mmRows.length };
      
    } catch (error) {
      console.error('Error auto-capturing existing transactions:', error);
      throw error;
    }
  }
}

module.exports = CashflowCaptureService;
