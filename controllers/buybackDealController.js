const BuybackDeal = require('../models/buybackDealModel');
const db = require('../config/database');

const buybackDealController = {
  // Create a new buyback deal
  createDeal: async (req, res) => {
    try {
      const { leg1, leg2, sellDeals } = req.body;
      
      // Validate required fields
      if (!leg1 || !leg2) {
        return res.status(400).json({ 
          success: false, 
          error: 'Both leg1 and leg2 data are required' 
        });
      }

      // Generate deal number
      const dealNumber = await BuybackDeal.generateDealNumber();

      // Prepare deal data
      const dealData = {
        deal_number: dealNumber,
        leg1: {
          tradeDate: leg1.tradeDate,
          valueDate: leg1.valueDate,
          transactionType: leg1.transactionType,
          tradeType: leg1.tradeType || 'BuyBack',
          isin: leg1.isin,
          counterparty: leg1.counterparty,
          broker: leg1.broker || null,
          portfolio: leg1.portfolio,
          strategy: leg1.strategy,
          custodian: leg1.custodian,
          settlementMode: leg1.settlementMode,
          brokerage: leg1.brokerage || 0,
          interestRate: leg1.interestRate || 0,
          faceValue: leg1.faceValue,
          yield: leg1.yield,
          settlementAmount: leg1.settlementAmount,
          cleanPrice: leg1.cleanPrice,
          dirtyPrice: leg1.dirtyPrice,
          accruedInterest: leg1.accruedInterest,
          currency: leg1.currency || 'LKR'
        },
        leg2: {
          tradeDate: leg2.tradeDate,
          valueDate: leg2.valueDate,
          transactionType: leg2.transactionType || 'Sell',
          tradeType: leg2.tradeType || 'BuyBack',
          isin: leg2.isin,
          counterparty: leg2.counterparty,
          portfolio: leg2.portfolio,
          strategy: leg2.strategy,
          custodian: leg2.custodian,
          settlementMode: leg2.settlementMode,
          faceValue: leg2.faceValue,
          yield: leg2.yield,
          settlementAmount: leg2.settlementAmount,
          cleanPrice: leg2.cleanPrice,
          dirtyPrice: leg2.dirtyPrice,
          accruedInterest: leg2.accruedInterest,
          currency: leg2.currency || 'LKR'
        },
        // ISIN metadata (from leg1)
        issueDate: leg1.issueDate,
        maturityDate: leg1.maturityDate,
        couponRate: leg1.couponRate,
        couponDate1: leg1.couponDate1,
        couponDate2: leg1.couponDate2,
        // Status and tracking
        deal_status: 'Pending_Verification',
        created_by: req.user?.id || 1, // TODO: Get from auth middleware
        notes: req.body.notes || null
      };

      const result = await BuybackDeal.create(dealData);
      
      // Handle sell deals if this is a sell transaction
      if (Array.isArray(sellDeals) && leg1.transactionType === 'Sell') {
        console.log('Processing sell deals for buyback:', sellDeals);
        
        for (const sellDeal of sellDeals) {
          if (sellDeal.buy_deal_number && sellDeal.amountToSell) {
            try {
              // Update the remaining face value of the original buy deal
              const [buyDeals] = await db.query(
                'SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = "Buy"', 
                [sellDeal.buy_deal_number]
              );
              
              if (buyDeals && buyDeals.length > 0) {
                const buyDeal = buyDeals[0];
                const original = parseFloat(buyDeal.remaining_face_value || buyDeal.face_value || 0);
                const sold = parseFloat(sellDeal.amountToSell || 0);
                let newRemaining = original - sold;
                
                // Truncate to 4 decimals (not round) - matching GSEC form logic
                newRemaining = Math.trunc(newRemaining * 10000) / 10000;
                
                await db.query(
                  'UPDATE gsec SET remaining_face_value = ? WHERE id = ?', 
                  [newRemaining.toFixed(4), buyDeal.id]
                );
                
                console.log(`Updated deal ${sellDeal.buy_deal_number}: Original ${original}, Sold ${sold}, New remaining ${newRemaining}`);
              } else {
                console.warn(`Buy deal not found for sell deal: ${sellDeal.buy_deal_number}`);
              }
            } catch (sellError) {
              console.error(`Error updating sell deal ${sellDeal.buy_deal_number}:`, sellError);
              // Continue with other sell deals even if one fails
            }
          }
        }
      }
      
      res.status(201).json({
        success: true,
        message: 'Buyback deal created successfully',
        data: {
          id: result.insertId,
          deal_number: dealNumber,
          status: 'Pending_Verification'
        }
      });

    } catch (error) {
      console.error('Error creating buyback deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create buyback deal: ' + error.message
      });
    }
  },

  // Get all buyback deals
  getAllDeals: async (req, res) => {
    try {
      const deals = await BuybackDeal.getAll();
      res.json({
        success: true,
        data: deals
      });
    } catch (error) {
      console.error('Error fetching buyback deals:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch buyback deals: ' + error.message
      });
    }
  },

  // Get a single buyback deal
  getDealById: async (req, res) => {
    try {
      const { id } = req.params;
      const deal = await BuybackDeal.getById(id);
      
      if (!deal) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      res.json({
        success: true,
        data: deal
      });
    } catch (error) {
      console.error('Error fetching buyback deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch buyback deal: ' + error.message
      });
    }
  },

  // Get deals by status
  getDealsByStatus: async (req, res) => {
    try {
      const { status } = req.params;
      const validStatuses = ['Draft', 'Pending_Verification', 'Verified', 'Pending_Final_Approval', 'Approved', 'Rejected', 'Settled'];
      
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Valid statuses: ' + validStatuses.join(', ')
        });
      }

      const deals = await BuybackDeal.getByStatus(status);
      res.json({
        success: true,
        data: deals
      });
    } catch (error) {
      console.error('Error fetching deals by status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch deals: ' + error.message
      });
    }
  },

  // Update deal status (for verification/approval workflow)
  updateDealStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, action } = req.body;
      const userId = req.user?.id || 1; // TODO: Get from auth middleware

      const validStatuses = ['Verified', 'Pending_Final_Approval', 'Approved', 'Rejected'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status for update'
        });
      }

      // Determine which field to update based on action and status
      let field = 'verified_by';
      let timestampField = 'verified_at';
      
      if (action === 'approve' || status === 'Approved') {
        field = 'approved_by';
        timestampField = 'approved_at';
      } else if (action === 'verify' || status === 'Verified') {
        field = 'verified_by';
        timestampField = 'verified_at';
      } else if (status === 'Pending_Final_Approval') {
        // This is when back office verifier approves, we need to track who verified it
        field = 'verified_by';
        timestampField = 'verified_at';
      }

      const result = await BuybackDeal.updateStatus(id, status, userId, field, timestampField);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      res.json({
        success: true,
        message: `Deal ${action || 'updated'} successfully`,
        data: {
          id,
          status,
          updated_by: userId,
          field
        }
      });

    } catch (error) {
      console.error('Error updating deal status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update deal status: ' + error.message
      });
    }
  },

  // Update deal data
  updateDeal: async (req, res) => {
    try {
      const { id } = req.params;
      const { leg1, leg2 } = req.body;

      if (!leg1 || !leg2) {
        return res.status(400).json({
          success: false,
          error: 'Both leg1 and leg2 data are required'
        });
      }

      const dealData = {
        leg1: {
          tradeDate: leg1.tradeDate,
          valueDate: leg1.valueDate,
          transactionType: leg1.transactionType,
          isin: leg1.isin,
          counterparty: leg1.counterparty,
          broker: leg1.broker,
          portfolio: leg1.portfolio,
          strategy: leg1.strategy,
          custodian: leg1.custodian,
          settlementMode: leg1.settlementMode,
          brokerage: leg1.brokerage || 0,
          interestRate: leg1.interestRate || 0,
          faceValue: leg1.faceValue,
          yield: leg1.yield,
          settlementAmount: leg1.settlementAmount,
          cleanPrice: leg1.cleanPrice,
          dirtyPrice: leg1.dirtyPrice,
          accruedInterest: leg1.accruedInterest
        },
        leg2: {
          tradeDate: leg2.tradeDate,
          valueDate: leg2.valueDate,
          transactionType: leg2.transactionType,
          isin: leg2.isin,
          counterparty: leg2.counterparty,
          portfolio: leg2.portfolio,
          strategy: leg2.strategy,
          custodian: leg2.custodian,
          settlementMode: leg2.settlementMode,
          faceValue: leg2.faceValue,
          yield: leg2.yield,
          settlementAmount: leg2.settlementAmount,
          cleanPrice: leg2.cleanPrice,
          dirtyPrice: leg2.dirtyPrice,
          accruedInterest: leg2.accruedInterest
        },
        notes: req.body.notes
      };

      const result = await BuybackDeal.update(id, dealData);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      res.json({
        success: true,
        message: 'Deal updated successfully'
      });

    } catch (error) {
      console.error('Error updating deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update deal: ' + error.message
      });
    }
  },

  // Delete deal
  deleteDeal: async (req, res) => {
    try {
      const { id } = req.params;
      const result = await BuybackDeal.delete(id);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      res.json({
        success: true,
        message: 'Deal deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting deal:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete deal: ' + error.message
      });
    }
  }
};

module.exports = buybackDealController;
