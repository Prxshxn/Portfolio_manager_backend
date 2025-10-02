const db = require('../config/database');

class CashflowModel {
  // Get cashflow statement (Operating, Investing, Financing)
  static async getCashflowStatement(filters = {}) {
    try {
      const { startDate, endDate, currency = 'LKR' } = filters;
      
      let query = `
        SELECT 
          cf.type,
          cf.name as category_name,
          SUM(CASE WHEN ct.flow_type = 'inflow' THEN ct.amount ELSE 0 END) as inflow,
          SUM(CASE WHEN ct.flow_type = 'outflow' THEN ct.amount ELSE 0 END) as outflow,
          SUM(CASE WHEN ct.flow_type = 'inflow' THEN ct.amount ELSE -ct.amount END) as net
        FROM cashflow_categories cf
        LEFT JOIN cashflow_transactions ct ON cf.id = ct.category_id
        WHERE cf.is_active = TRUE
      `;
      
      const params = [];
      
      if (startDate) {
        query += ` AND ct.transaction_date >= ?`;
        params.push(startDate);
      }
      
      if (endDate) {
        query += ` AND ct.transaction_date <= ?`;
        params.push(endDate);
      }
      
      if (currency) {
        query += ` AND (ct.currency = ? OR ct.currency IS NULL)`;
        params.push(currency);
      }
      
      query += `
        GROUP BY cf.id, cf.type, cf.name
        ORDER BY cf.type, cf.name
      `;
      
      const [rows] = await db.query(query, params);
      
      // Group by cashflow type
      const result = {
        operating: { categories: [], total: { inflow: 0, outflow: 0, net: 0 } },
        investing: { categories: [], total: { inflow: 0, outflow: 0, net: 0 } },
        financing: { categories: [], total: { inflow: 0, outflow: 0, net: 0 } }
      };
      
      rows.forEach(row => {
        const category = {
          name: row.category_name,
          inflow: parseFloat(row.inflow) || 0,
          outflow: parseFloat(row.outflow) || 0,
          net: parseFloat(row.net) || 0
        };
        
        result[row.type].categories.push(category);
        result[row.type].total.inflow += category.inflow;
        result[row.type].total.outflow += category.outflow;
        result[row.type].total.net += category.net;
      });
      
      // Calculate net cashflow
      result.netCashflow = result.operating.total.net + 
                          result.investing.total.net + 
                          result.financing.total.net;
      
      return result;
    } catch (error) {
      console.error('Error getting cashflow statement:', error);
      throw error;
    }
  }

  // Get cashflow projections
  static async getCashflowProjections(filters = {}) {
    try {
      const { startDate, endDate, days = 30 } = filters;
      
      let query = `
        SELECT 
          cp.projection_date,
          cf.type,
          cf.name as category_name,
          cp.projected_inflow,
          cp.projected_outflow,
          cp.confidence_level,
          cp.notes
        FROM cashflow_projections cp
        JOIN cashflow_categories cf ON cp.category_id = cf.id
        WHERE cf.is_active = TRUE
      `;
      
      const params = [];
      
      if (startDate) {
        query += ` AND cp.projection_date >= ?`;
        params.push(startDate);
      }
      
      if (endDate) {
        query += ` AND cp.projection_date <= ?`;
        params.push(endDate);
      }
      
      query += ` ORDER BY cp.projection_date, cf.type, cf.name`;
      
      const [rows] = await db.query(query, params);
      
      // Group by date
      const projectionsByDate = {};
      
      rows.forEach(row => {
        const date = row.projection_date.toISOString().split('T')[0];
        
        if (!projectionsByDate[date]) {
          projectionsByDate[date] = {
            date,
            operating: { inflow: 0, outflow: 0, net: 0 },
            investing: { inflow: 0, outflow: 0, net: 0 },
            financing: { inflow: 0, outflow: 0, net: 0 },
            total: { inflow: 0, outflow: 0, net: 0 }
          };
        }
        
        const inflow = parseFloat(row.projected_inflow) || 0;
        const outflow = parseFloat(row.projected_outflow) || 0;
        const net = inflow - outflow;
        
        projectionsByDate[date][row.type].inflow += inflow;
        projectionsByDate[date][row.type].outflow += outflow;
        projectionsByDate[date][row.type].net += net;
        
        projectionsByDate[date].total.inflow += inflow;
        projectionsByDate[date].total.outflow += outflow;
        projectionsByDate[date].total.net += net;
      });
      
      return Object.values(projectionsByDate);
    } catch (error) {
      console.error('Error getting cashflow projections:', error);
      throw error;
    }
  }

  // Create cashflow transaction
  static async createCashflowTransaction(transactionData) {
    try {
      const {
        category_id,
        transaction_date,
        amount,
        flow_type,
        currency = 'LKR',
        description,
        reference_number,
        counterparty,
        created_by
      } = transactionData;
      
      const query = `
        INSERT INTO cashflow_transactions 
        (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const [result] = await db.query(query, [
        category_id,
        transaction_date,
        amount,
        flow_type,
        currency,
        description,
        reference_number,
        counterparty,
        created_by
      ]);
      
      return result.insertId;
    } catch (error) {
      console.error('Error creating cashflow transaction:', error);
      throw error;
    }
  }

  // Auto-categorize transactions from existing transaction tables
  static async autoCategorizeTransactions() {
    try {
      // Get all cashflow categories
      const [categories] = await db.query(`
        SELECT id, name, type FROM cashflow_categories WHERE is_active = TRUE
      `);
      
      const categoryMap = {};
      categories.forEach(cat => {
        categoryMap[cat.name.toLowerCase()] = cat;
      });
      
      // Categorize money market transactions
      const [mmTransactions] = await db.query(`
        SELECT id, deal_number, principal_amount, interest_amount, maturity_value, 
               deal_date, counterparty_id, 'money_market' as source
        FROM money_market_deals 
        WHERE deal_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      `);
      
      let categorizedCount = 0;
      
      for (const transaction of mmTransactions) {
        // Interest income
        if (transaction.interest_amount > 0) {
          const interestCategory = categoryMap['interest income'];
          if (interestCategory) {
            await db.query(`
              INSERT IGNORE INTO cashflow_transactions 
              (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty)
              VALUES (?, ?, ?, 'inflow', 'LKR', ?, ?, ?)
            `, [
              interestCategory.id,
              transaction.deal_date,
              transaction.interest_amount,
              `Interest from MM Deal ${transaction.deal_number}`,
              transaction.deal_number,
              transaction.counterparty_id
            ]);
            categorizedCount++;
          }
        }
        
        // Principal outflow (investment)
        if (transaction.principal_amount > 0) {
          const investmentCategory = categoryMap['investment purchases'];
          if (investmentCategory) {
            await db.query(`
              INSERT IGNORE INTO cashflow_transactions 
              (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty)
              VALUES (?, ?, ?, 'outflow', 'LKR', ?, ?, ?)
            `, [
              investmentCategory.id,
              transaction.deal_date,
              transaction.principal_amount,
              `MM Investment ${transaction.deal_number}`,
              transaction.deal_number,
              transaction.counterparty_id
            ]);
            categorizedCount++;
          }
        }
      }
      
      return { categorizedCount, totalTransactions: mmTransactions.length };
    } catch (error) {
      console.error('Error auto-categorizing transactions:', error);
      throw error;
    }
  }

  // Get cashflow categories
  static async getCashflowCategories() {
    try {
      const [rows] = await db.query(`
        SELECT id, name, type, description, is_active
        FROM cashflow_categories 
        WHERE is_active = TRUE
        ORDER BY type, name
      `);
      
      return rows;
    } catch (error) {
      console.error('Error getting cashflow categories:', error);
      throw error;
    }
  }

  // Reconcile cashflow
  static async reconcileCashflow(reconciliationData) {
    try {
      const {
        reconciliation_date,
        opening_balance,
        closing_balance,
        total_inflow,
        total_outflow,
        notes,
        reconciled_by
      } = reconciliationData;
      
      const variance = closing_balance - (opening_balance + total_inflow - total_outflow);
      
      const query = `
        INSERT INTO cashflow_reconciliation 
        (reconciliation_date, opening_balance, closing_balance, total_inflow, total_outflow, variance, notes, reconciled_by, reconciled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      
      const [result] = await db.query(query, [
        reconciliation_date,
        opening_balance,
        closing_balance,
        total_inflow,
        total_outflow,
        variance,
        notes,
        reconciled_by
      ]);
      
      return result.insertId;
    } catch (error) {
      console.error('Error reconciling cashflow:', error);
      throw error;
    }
  }

  // Get cashflow transactions with filters
  static async getCashflowTransactions(filters = {}) {
    try {
      const { startDate, endDate, categoryId, flowType, status, limit = 100, offset = 0 } = filters;
      
      let query = `
        SELECT 
          ct.*,
          cf.name as category_name,
          cf.type as category_type
        FROM cashflow_transactions ct
        JOIN cashflow_categories cf ON ct.category_id = cf.id
        WHERE 1=1
      `;
      
      const params = [];
      
      if (startDate) {
        query += ` AND ct.transaction_date >= ?`;
        params.push(startDate);
      }
      
      if (endDate) {
        query += ` AND ct.transaction_date <= ?`;
        params.push(endDate);
      }
      
      if (categoryId) {
        query += ` AND ct.category_id = ?`;
        params.push(categoryId);
      }
      
      if (flowType) {
        query += ` AND ct.flow_type = ?`;
        params.push(flowType);
      }
      
      if (status) {
        query += ` AND ct.status = ?`;
        params.push(status);
      }
      
      query += ` ORDER BY ct.transaction_date DESC, ct.created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const [rows] = await db.query(query, params);
      
      return rows;
    } catch (error) {
      console.error('Error getting cashflow transactions:', error);
      throw error;
    }
  }
}

module.exports = CashflowModel;
