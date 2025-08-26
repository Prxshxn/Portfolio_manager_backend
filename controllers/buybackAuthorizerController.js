const BuybackAuthorizer = require('../models/buybackAuthorizerModel');

const buybackAuthorizerController = {
  // Create new buyback authorizer assignment
  createAuthorizer: async (req, res) => {
    try {
      const { user_id, transaction_type, role, per_deal_limit, per_day_limit, allowed_pages } = req.body;

      // Validate required fields
      if (!user_id || !role) {
        return res.status(400).json({
          success: false,
          error: 'User ID and role are required'
        });
      }

      // Check if user already has an assignment for this transaction type
      const existing = await BuybackAuthorizer.getByUserAndType(user_id, 'Buyback');
      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'User already has a buyback authorizer assignment'
        });
      }

      const authorizerData = {
        user_id,
        transaction_type: 'Buyback',
        role,
        per_deal_limit: parseFloat(per_deal_limit) || 0,
        per_day_limit: parseFloat(per_day_limit) || 0,
        allowed_pages
      };

      const result = await BuybackAuthorizer.create(authorizerData);

      res.status(201).json({
        success: true,
        message: 'Buyback authorizer assigned successfully',
        data: { id: result.insertId }
      });

    } catch (error) {
      console.error('Error creating buyback authorizer:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create authorizer: ' + error.message
      });
    }
  },

  // Get all buyback authorizer assignments
  getAllAuthorizers: async (req, res) => {
    try {
      const authorizers = await BuybackAuthorizer.getAll();
      res.json({
        success: true,
        data: authorizers
      });
    } catch (error) {
      console.error('Error fetching buyback authorizers:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch authorizers: ' + error.message
      });
    }
  },

  // Get authorizer by user and transaction type
  getAuthorizerByUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const authorizer = await BuybackAuthorizer.getByUserAndType(userId, 'Buyback');
      
      if (!authorizer) {
        return res.status(404).json({
          success: false,
          error: 'Authorizer assignment not found'
        });
      }

      res.json({
        success: true,
        data: authorizer
      });
    } catch (error) {
      console.error('Error fetching authorizer:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch authorizer: ' + error.message
      });
    }
  },

  // Check if user has specific role
  checkUserRole: async (req, res) => {
    try {
      const { userId, role } = req.params;
      const hasRole = await BuybackAuthorizer.hasRole(userId, role);
      
      res.json({
        success: true,
        data: { hasRole }
      });
    } catch (error) {
      console.error('Error checking user role:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check user role: ' + error.message
      });
    }
  },

  // Update authorizer assignment
  updateAuthorizer: async (req, res) => {
    try {
      const { id } = req.params;
      const { role, per_deal_limit, per_day_limit, allowed_pages } = req.body;

      const authorizerData = {
        role,
        per_deal_limit: parseFloat(per_deal_limit) || 0,
        per_day_limit: parseFloat(per_day_limit) || 0,
        allowed_pages
      };

      const result = await BuybackAuthorizer.update(id, authorizerData);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Authorizer assignment not found'
        });
      }

      res.json({
        success: true,
        message: 'Authorizer updated successfully'
      });

    } catch (error) {
      console.error('Error updating authorizer:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update authorizer: ' + error.message
      });
    }
  },

  // Delete authorizer assignment
  deleteAuthorizer: async (req, res) => {
    try {
      const { id } = req.params;
      const result = await BuybackAuthorizer.delete(id);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Authorizer assignment not found'
        });
      }

      res.json({
        success: true,
        message: 'Authorizer assignment removed successfully'
      });

    } catch (error) {
      console.error('Error deleting authorizer:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete authorizer: ' + error.message
      });
    }
  },

  // Check user limits for deal amount
  checkLimits: async (req, res) => {
    try {
      const { userId } = req.params;
      const { dealAmount } = req.body;

      const limitCheck = await BuybackAuthorizer.checkLimits(userId, parseFloat(dealAmount));

      res.json({
        success: true,
        data: limitCheck
      });

    } catch (error) {
      console.error('Error checking limits:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check limits: ' + error.message
      });
    }
  }
};

module.exports = buybackAuthorizerController;
