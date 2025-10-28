const BuybackDeal = require('../models/buybackDealModel');
const Gsec = require('../models/gsec');
const db = require('../config/database');

const buybackDealController = {
  // Create a new buyback deal
  createDeal: async (req, res) => {
    try {
      const { leg1, leg2, sellDeals, source_buy_deal_number } = req.body;
      
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
        notes: req.body.notes || null,
        source_buy_deal_number: source_buy_deal_number || null
      };

      const result = await BuybackDeal.create(dealData);
      
      // CRITICAL: If leg2 is a Buy transaction, automatically create a GSec deal
      // This mirrors the behavior when manually creating a buy deal in Fixed Income GSec page
      if (leg2.transactionType === 'Buy') {
        try {
          console.log('Creating automatic GSec deal for buyback leg2 (Buy transaction)...');
          
          // Fetch ISIN master data for the leg
          const [isinData] = await db.query(
            'SELECT * FROM isin_master WHERE isin_number = ?',
            [leg2.isin]
          );
          
          if (isinData && isinData.length > 0) {
            const isin = isinData[0];
            
            // Calculate coupon dates from ISIN master data
            const issueDate = leg1.issueDate || isin.issue_date;
            const maturityDate = leg1.maturityDate || isin.maturity_date;
            const couponDate1 = leg1.couponDate1 || isin.coupon_date_1;
            const couponDate2 = leg1.couponDate2 || isin.coupon_date_2;
            
            // Fetch coupon schedule for this ISIN
            const [couponSchedule] = await db.query(
              'SELECT * FROM isin_coupon_schedule WHERE isin = ? ORDER BY coupon_date ASC',
              [leg2.isin]
            );
            
            let lastCouponDate = null;
            let nextCouponDate = null;
            
            if (couponSchedule && couponSchedule.length > 0) {
              const valueDateObj = new Date(leg2.valueDate);
              
              for (let i = 0; i < couponSchedule.length; i++) {
                const couponDate = new Date(couponSchedule[i].coupon_date);
                if (couponDate <= valueDateObj) {
                  lastCouponDate = couponSchedule[i].coupon_date;
                }
                if (couponDate > valueDateObj) {
                  nextCouponDate = couponSchedule[i].coupon_date;
                  break;
                }
              }
            }
            
            // Calculate coupon interest
            const couponRate = leg1.couponRate || isin.coupon_rate || 0;
            const couponInterest = (parseFloat(leg2.faceValue) * parseFloat(couponRate)) / 100;
            
            // Calculate number of days if we have coupon dates
            let numberOfDaysInterestAccrued = null;
            let numberOfDaysForCouponPeriod = null;
            
            if (lastCouponDate && nextCouponDate && leg2.valueDate) {
              const lastDate = new Date(lastCouponDate);
              const nextDate = new Date(nextCouponDate);
              const valueDate = new Date(leg2.valueDate);
              
              numberOfDaysInterestAccrued = Math.floor((valueDate - lastDate) / (1000 * 60 * 60 * 24));
              numberOfDaysForCouponPeriod = Math.floor((nextDate - lastDate) / (1000 * 60 * 60 * 24));
            }
            
          // Use pre-calculated values from leg2 (already calculated in frontend like manual GSec form)
          // If not provided, calculate fallback values from coupon schedule or pricing service
          const { calculatePrices } = require('../services/bondPricingService');

          // If prices are missing, compute them server-side to ensure DB is complete
          if ((!leg2.cleanPrice || !leg2.dirtyPrice || !leg2.accruedInterestPer100) && leg2.couponRate && leg2.yield) {
            const calc = calculatePrices({
              couponRate: leg2.couponRate,
              yieldRate: leg2.yield,
              valueDate: leg2.valueDate,
              maturityDate: leg2.maturityDate || maturityDate,
              issueDate: leg2.issueDate || issueDate,
              couponDate1: leg2.couponDate1 || couponDate1,
              couponDate2: leg2.couponDate2 || couponDate2
            });
            leg2.cleanPrice = leg2.cleanPrice || calc.cleanPrice;
            leg2.dirtyPrice = leg2.dirtyPrice || calc.dirtyPrice;
            leg2.accruedInterestPer100 = leg2.accruedInterestPer100 || calc.accruedInterestPer100;
          }
            const gsecDealData = {
              tradeType: leg2.tradeType || 'BuyBack',
              transactionType: 'Buy',
              counterparty: leg2.counterparty,
              broker: leg2.broker || null,
              dealNumber: null, // Will be auto-generated
              isin: leg2.isin,
              faceValue: leg2.faceValue,
              valueDate: leg2.valueDate,
              nextCouponDate: leg2.nextCouponDate || nextCouponDate,
              lastCouponDate: leg2.lastCouponDate || lastCouponDate,
              numberOfDaysInterestAccrued: leg2.numberOfDaysInterestAccrued || numberOfDaysInterestAccrued,
              numberOfDaysForCouponPeriod: leg2.numberOfDaysForCouponPeriod || numberOfDaysForCouponPeriod,
              accruedInterest: leg2.accruedInterestPer100 || leg2.accruedInterest || null,
              couponInterest: leg2.couponInterest || couponInterest,
              cleanPrice: leg2.cleanPrice,
              dirtyPrice: leg2.dirtyPrice,
              accruedInterestCalculation: leg2.accruedInterestCalculation || leg2.accruedInterestPer100,
              accruedInterestSixDecimals: leg2.accruedInterestSixDecimals || null,
              accruedInterestFor100: leg2.accruedInterestFor100 || null,
              accruedInterestBase: leg2.accruedInterestBase || null,
              settlementAmount: leg2.settlementAmount,
              settlementMode: leg2.settlementMode,
              issueDate: leg2.issueDate || issueDate,
              maturityDate: leg2.maturityDate || maturityDate,
              couponDates: leg2.couponDate1 && leg2.couponDate2 ? `${leg2.couponDate1},${leg2.couponDate2}` : `${couponDate1},${couponDate2}`,
              yield: leg2.yield,
              brokerage: leg2.brokerage || 0,
              currency: leg2.currency || 'LKR',
              portfolio: leg2.portfolio,
              strategy: leg2.strategy,
              accruedInterestAdjustment: null,
              cleanPriceAdjustment: null,
              custodian: leg2.custodian,
              tradeDate: leg2.tradeDate || leg2.valueDate,
              userId: req.user?.id || 1,
              current_approval_level: 1, // Start at front office
              status: 'pending'
            };
            
            // Create the GSec deal
            const gsecResult = await Gsec.create(gsecDealData);
            console.log(`Successfully created GSec deal with ID: ${gsecResult.insertId}`);
            
            // Optionally, you could update the buyback deal to reference this GSec deal
            // await db.query('UPDATE buyback_deals SET leg2_gsec_deal_id = ? WHERE id = ?', 
            //                [gsecResult.insertId, result.insertId]);
            
            console.log('Automatic GSec deal creation completed successfully');
          } else {
            console.warn(`ISIN master data not found for ${leg2.isin}, skipping automatic GSec creation`);
          }
        } catch (gsecError) {
          console.error('Error creating automatic GSec deal:', gsecError);
          // Don't fail the buyback creation if GSec creation fails
          // Log the error but continue
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

      // Process face value deduction when deal is approved
      if (status === 'Approved') {
        try {
          // Get the buyback deal details
          const [buybackDeals] = await db.query('SELECT * FROM buyback_deals WHERE id = ?', [id]);
          if (buybackDeals && buybackDeals.length > 0) {
            const buybackDeal = buybackDeals[0];
            
            // If this is a sell transaction, deduct from original buy deals
            if (buybackDeal.leg1_transaction_type === 'Sell') {
              console.log('Processing face value deduction for approved buyback deal:', buybackDeal.deal_number);
              
              const sellAmount = parseFloat(buybackDeal.leg1_face_value || 0);
              const isin = buybackDeal.leg1_isin;
              const portfolio = buybackDeal.leg1_portfolio;
              const sourceBuyDealNumber = buybackDeal.source_buy_deal_number;
              
              if (sellAmount > 0 && isin && portfolio) {
                let buyDeals = [];
                
                // If we have a specific source buy deal number, deduct from that deal
                if (sourceBuyDealNumber) {
                  console.log(`Deducting from specific buy deal: ${sourceBuyDealNumber}`);
                  const [specificBuyDeals] = await db.query(`
                    SELECT * FROM gsec 
                    WHERE deal_number = ? AND transaction_type = 'Buy' 
                    AND remaining_face_value > 0
                  `, [sourceBuyDealNumber]);
                  
                  if (specificBuyDeals && specificBuyDeals.length > 0) {
                    buyDeals = specificBuyDeals;
                    console.log(`Found specific buy deal: ${sourceBuyDealNumber} with remaining: ${specificBuyDeals[0].remaining_face_value}`);
                  } else {
                    console.warn(`Specific buy deal ${sourceBuyDealNumber} not found or has no remaining balance`);
                  }
                }
                
                // If no specific deal or specific deal not found, fall back to chronological order
                if (buyDeals.length === 0) {
                  console.log('Falling back to chronological order for deduction');
                  const [chronologicalBuyDeals] = await db.query(`
                    SELECT * FROM gsec 
                    WHERE isin = ? AND portfolio = ? AND transaction_type = 'Buy' 
                    AND remaining_face_value > 0
                    ORDER BY created_at ASC
                  `, [isin, portfolio]);
                  buyDeals = chronologicalBuyDeals;
                }
                
                console.log(`Found ${buyDeals.length} buy deals for deduction`);
                
                let remainingToDeduct = sellAmount;
                
                for (const buyDeal of buyDeals) {
                  if (remainingToDeduct <= 0) break;
                  
                  const availableToDeduct = parseFloat(buyDeal.remaining_face_value || buyDeal.face_value || 0);
                  const deductAmount = Math.min(remainingToDeduct, availableToDeduct);
                  
                  if (deductAmount > 0) {
                    const newRemaining = availableToDeduct - deductAmount;
                    const truncatedRemaining = Math.trunc(newRemaining * 10000) / 10000;
                    
                    // Update the remaining face value
                    await db.query(
                      'UPDATE gsec SET remaining_face_value = ? WHERE id = ?', 
                      [truncatedRemaining.toFixed(4), buyDeal.id]
                    );
                    
                    console.log(`Deducted ${deductAmount} from buy deal ${buyDeal.deal_number}. New remaining: ${truncatedRemaining}`);
                    
                    remainingToDeduct -= deductAmount;
                  }
                }
                
                if (remainingToDeduct > 0) {
                  console.warn(`Could not fully deduct ${remainingToDeduct} from buyback deal ${buybackDeal.deal_number} - insufficient buy deal balances`);
                }
              }
            }
          }
        } catch (deductionError) {
          console.error('Error processing face value deduction for approved buyback:', deductionError);
          // Don't fail the approval if deduction fails - log and continue
        }
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
