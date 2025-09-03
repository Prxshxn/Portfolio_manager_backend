const RepoDeal = require('../models/repoDealModel');

const repoDealController = {
  // Create a new repo deal
  create: async (req, res) => {
    try {
             const {
         dealType,
         counterparty,
         tradeDate,
        valueDate,
        maturityDate,
        principalAmount,
        interestAmount,
        rate,
        maturityAmount,
        tenor,
        calculationDayBasis,
        isin,
        issueDate,
        haircut,
        faceValue,
        faceValueAdjustment,
        faceValueAsPerCounterparty
      } = req.body;

             // Validation
       if (!dealType || !counterparty || !tradeDate || !valueDate || !maturityDate || 
           !principalAmount || !rate || !tenor || !calculationDayBasis || !isin) {
         return res.status(400).json({
           success: false,
           message: 'Missing required fields'
         });
       }

      // Validate deal type
      if (!['Repo', 'Reverse Repo'].includes(dealType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid deal type. Must be "Repo" or "Reverse Repo"'
        });
      }

      

      // Validate dates
      const trade = new Date(tradeDate);
      const value = new Date(valueDate);
      const maturity = new Date(maturityDate);
      
      if (value < trade) {
        return res.status(400).json({
          success: false,
          message: 'Value date cannot be before trade date'
        });
      }
      
      if (maturity <= value) {
        return res.status(400).json({
          success: false,
          message: 'Maturity date must be after value date'
        });
      }

      // Validate amounts
      if (principalAmount <= 0 || rate <= 0 || tenor <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Principal amount, rate, and tenor must be positive values'
        });
      }

      // Validate day basis
      if (![364, 365].includes(parseInt(calculationDayBasis))) {
        return res.status(400).json({
          success: false,
          message: 'Calculation day basis must be 364 or 365'
        });
      }

             // Create deal data object
       const dealData = {
         dealType,
         counterparty,
         tradeDate,
        valueDate,
        maturityDate,
        principalAmount: parseFloat(principalAmount),
        interestAmount: parseFloat(interestAmount) || 0,
        rate: parseFloat(rate),
        maturityAmount: parseFloat(maturityAmount) || 0,
        tenor: parseInt(tenor),
        calculationDayBasis: parseInt(calculationDayBasis),
        isin,
        issueDate,
        haircut: parseFloat(haircut) || 0,
        faceValue: parseFloat(faceValue) || null,
        faceValueAdjustment: parseFloat(faceValueAdjustment) || 0,
        faceValueAsPerCounterparty: parseFloat(faceValueAsPerCounterparty) || null,
        createdBy: req.user?.id || 1 // From auth middleware, fallback to user ID 1
      };

      // Create the repo deal
      const newDeal = await RepoDeal.create(dealData);

      res.status(201).json({
        success: true,
        message: 'Repo deal created successfully',
        data: newDeal
      });

    } catch (error) {
      console.error('Error creating repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get all repo deals with optional filters
  getAll: async (req, res) => {
    try {
      const filters = {
        dealType: req.query.dealType,
        status: req.query.status,
        counterpartyId: req.query.counterpartyId,
        startDate: req.query.startDate,
        endDate: req.query.endDate
      };

      const deals = await RepoDeal.getAll(filters);

      res.json({
        success: true,
        message: 'Repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching repo deals:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get repo deal by ID
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      const deal = await RepoDeal.getById(parseInt(id));
      
      if (!deal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      res.json({
        success: true,
        message: 'Repo deal retrieved successfully',
        data: deal
      });

    } catch (error) {
      console.error('Error fetching repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Update repo deal
  update: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      // Check if deal exists
      const existingDeal = await RepoDeal.getById(parseInt(id));
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      // Only allow updates if deal is not matured or cancelled
      if (['Matured', 'Cancelled'].includes(existingDeal.status)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update matured or cancelled deals'
        });
      }

      const updateData = { ...req.body };
      
      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.created_by;
      delete updateData.created_at;
      delete updateData.updated_at;

      // Validate dates if provided
      if (updateData.valueDate && updateData.tradeDate) {
        const value = new Date(updateData.valueDate);
        const trade = new Date(updateData.tradeDate);
        if (value < trade) {
          return res.status(400).json({
            success: false,
            message: 'Value date cannot be before trade date'
          });
        }
      }

      if (updateData.maturityDate && updateData.valueDate) {
        const maturity = new Date(updateData.maturityDate);
        const value = new Date(updateData.valueDate);
        if (maturity <= value) {
          return res.status(400).json({
            success: false,
            message: 'Maturity date must be after value date'
          });
        }
      }

      // Update the deal
      const updatedDeal = await RepoDeal.update(parseInt(id), updateData);

      res.json({
        success: true,
        message: 'Repo deal updated successfully',
        data: updatedDeal
      });

    } catch (error) {
      console.error('Error updating repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Delete repo deal
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      // Check if deal exists
      const existingDeal = await RepoDeal.getById(parseInt(id));
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      // Only allow deletion if deal is pending
      if (existingDeal.status !== 'Pending') {
        return res.status(400).json({
          success: false,
          message: 'Can only delete pending deals'
        });
      }

      await RepoDeal.delete(parseInt(id));

      res.json({
        success: true,
        message: 'Repo deal deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting repo deal:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Update deal status
  updateStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: 'Valid ID is required'
        });
      }

      if (!status || !['Pending', 'Active', 'Matured', 'Cancelled'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Valid status is required (Pending, Active, Matured, Cancelled)'
        });
      }

      // Check if deal exists
      const existingDeal = await RepoDeal.getById(parseInt(id));
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          message: 'Repo deal not found'
        });
      }

      // Update the status
      const updatedDeal = await RepoDeal.updateStatus(parseInt(id), status);

      res.json({
        success: true,
        message: 'Repo deal status updated successfully',
        data: updatedDeal
      });

    } catch (error) {
      console.error('Error updating repo deal status:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get repo deals by counterparty
  getByCounterparty: async (req, res) => {
    try {
      const { counterpartyId } = req.params;
      
      if (!counterpartyId || isNaN(parseInt(counterpartyId))) {
        return res.status(400).json({
          success: false,
          message: 'Valid counterparty ID is required'
        });
      }

      const deals = await RepoDeal.getByCounterparty(parseInt(counterpartyId));

      res.json({
        success: true,
        message: 'Repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching repo deals by counterparty:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get repo deals by ISIN
  getByIsin: async (req, res) => {
    try {
      const { isinNumber } = req.params;
      
      if (!isinNumber) {
        return res.status(400).json({
          success: false,
          message: 'ISIN number is required'
        });
      }

      const deals = await RepoDeal.getByIsin(isinNumber);

      res.json({
        success: true,
        message: 'Repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching repo deals by ISIN:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get active repo deals
  getActive: async (req, res) => {
    try {
      const deals = await RepoDeal.getActive();

      res.json({
        success: true,
        message: 'Active repo deals retrieved successfully',
        data: deals
      });

    } catch (error) {
      console.error('Error fetching active repo deals:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get expiring repo deals
  getExpiringSoon: async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 7;
      
      if (days < 1 || days > 365) {
        return res.status(400).json({
          success: false,
          message: 'Days must be between 1 and 365'
        });
      }

      const deals = await RepoDeal.getExpiringSoon(days);

      res.json({
        success: true,
        message: `Repo deals expiring within ${days} days retrieved successfully`,
        data: deals
      });

    } catch (error) {
      console.error('Error fetching expiring repo deals:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  },

  // Get summary statistics
  getSummary: async (req, res) => {
    try {
      const summary = await RepoDeal.getSummary();

      res.json({
        success: true,
        message: 'Repo deals summary retrieved successfully',
        data: summary
      });

    } catch (error) {
      console.error('Error fetching repo deals summary:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
};

module.exports = repoDealController;
