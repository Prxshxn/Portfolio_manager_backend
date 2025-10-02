const CashflowModel = require('../models/cashflowModel');
const CashflowCaptureService = require('../services/cashflowCaptureService');

class CashflowController {
  // Get cashflow statement
  static async getCashflowStatement(req, res) {
    try {
      const { startDate, endDate, currency } = req.query;
      
      const filters = {
        startDate,
        endDate,
        currency: currency || 'LKR'
      };
      
      const cashflowStatement = await CashflowModel.getCashflowStatement(filters);
      
      res.json({
        success: true,
        data: cashflowStatement
      });
    } catch (error) {
      console.error('Error getting cashflow statement:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting cashflow statement',
        error: error.message
      });
    }
  }

  // Get cashflow projections
  static async getCashflowProjections(req, res) {
    try {
      const { startDate, endDate, days } = req.query;
      
      const filters = {
        startDate,
        endDate,
        days: parseInt(days) || 30
      };
      
      const projections = await CashflowModel.getCashflowProjections(filters);
      
      res.json({
        success: true,
        data: projections
      });
    } catch (error) {
      console.error('Error getting cashflow projections:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting cashflow projections',
        error: error.message
      });
    }
  }

  // Get cashflow transactions
  static async getCashflowTransactions(req, res) {
    try {
      const { 
        startDate, 
        endDate, 
        categoryId, 
        flowType, 
        status, 
        limit, 
        offset 
      } = req.query;
      
      const filters = {
        startDate,
        endDate,
        categoryId: categoryId ? parseInt(categoryId) : undefined,
        flowType,
        status,
        limit: limit ? parseInt(limit) : 100,
        offset: offset ? parseInt(offset) : 0
      };
      
      const transactions = await CashflowModel.getCashflowTransactions(filters);
      
      res.json({
        success: true,
        data: transactions
      });
    } catch (error) {
      console.error('Error getting cashflow transactions:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting cashflow transactions',
        error: error.message
      });
    }
  }

  // Create cashflow transaction
  static async createCashflowTransaction(req, res) {
    try {
      const {
        category_id,
        transaction_date,
        amount,
        flow_type,
        currency,
        description,
        reference_number,
        counterparty
      } = req.body;
      
      // Validation
      if (!category_id || !transaction_date || !amount || !flow_type) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: category_id, transaction_date, amount, flow_type'
        });
      }
      
      if (amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be greater than 0'
        });
      }
      
      if (!['inflow', 'outflow'].includes(flow_type)) {
        return res.status(400).json({
          success: false,
          message: 'flow_type must be either "inflow" or "outflow"'
        });
      }
      
      const transactionData = {
        category_id,
        transaction_date,
        amount,
        flow_type,
        currency: currency || 'LKR',
        description,
        reference_number,
        counterparty,
        created_by: req.user.id
      };
      
      const transactionId = await CashflowModel.createCashflowTransaction(transactionData);
      
      res.status(201).json({
        success: true,
        message: 'Cashflow transaction created successfully',
        data: { id: transactionId }
      });
    } catch (error) {
      console.error('Error creating cashflow transaction:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating cashflow transaction',
        error: error.message
      });
    }
  }

  // Auto-categorize transactions
  static async autoCategorizeTransactions(req, res) {
    try {
      // Use the new comprehensive capture service
      const result = await CashflowCaptureService.autoCaptureExistingTransactions();
      
      res.json({
        success: true,
        message: `Auto-categorization completed. ${result.totalCaptured} cashflow entries captured from existing transactions.`,
        data: result
      });
    } catch (error) {
      console.error('Error auto-categorizing transactions:', error);
      res.status(500).json({
        success: false,
        message: 'Error auto-categorizing transactions',
        error: error.message
      });
    }
  }

  // Get cashflow categories
  static async getCashflowCategories(req, res) {
    try {
      const categories = await CashflowModel.getCashflowCategories();
      
      res.json({
        success: true,
        data: categories
      });
    } catch (error) {
      console.error('Error getting cashflow categories:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting cashflow categories',
        error: error.message
      });
    }
  }

  // Reconcile cashflow
  static async reconcileCashflow(req, res) {
    try {
      const {
        reconciliation_date,
        opening_balance,
        closing_balance,
        total_inflow,
        total_outflow,
        notes
      } = req.body;
      
      // Validation
      if (!reconciliation_date || opening_balance === undefined || closing_balance === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: reconciliation_date, opening_balance, closing_balance'
        });
      }
      
      const reconciliationData = {
        reconciliation_date,
        opening_balance,
        closing_balance,
        total_inflow: total_inflow || 0,
        total_outflow: total_outflow || 0,
        notes,
        reconciled_by: req.user.id
      };
      
      const reconciliationId = await CashflowModel.reconcileCashflow(reconciliationData);
      
      res.status(201).json({
        success: true,
        message: 'Cashflow reconciliation completed successfully',
        data: { id: reconciliationId }
      });
    } catch (error) {
      console.error('Error reconciling cashflow:', error);
      res.status(500).json({
        success: false,
        message: 'Error reconciling cashflow',
        error: error.message
      });
    }
  }
}

module.exports = CashflowController;
