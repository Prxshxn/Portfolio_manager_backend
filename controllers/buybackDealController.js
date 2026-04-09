const BuybackDeal = require('../models/buybackDealModel');
const Gsec = require('../models/gsec');
const db = require('../config/database');
const holidayValidationService = require('../services/holidayValidationService');

// Helper function to convert empty strings to null for numeric fields
const sanitizeNumeric = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
};

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

      // Holiday validation - check if transaction dates are holidays
      // Check both legs for holidays
      const currency1 = leg1.currency || 'LKR';
      const currency2 = leg2.currency || 'LKR';
      
      // Check leg1 dates
      const holidayValidation1 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg1.tradeDate,
        valueDate: leg1.valueDate,
        currency: currency1
      });

      if (holidayValidation1.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 1: ${holidayValidation1.message}`
        });
      }

      // Check leg2 dates
      const holidayValidation2 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg2.tradeDate,
        valueDate: leg2.valueDate,
        currency: currency2
      });

      if (holidayValidation2.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 2: ${holidayValidation2.message}`
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
          brokerage: sanitizeNumeric(leg1.brokerage) || 0,
          interestRate: sanitizeNumeric(leg1.interestRate) || 0,
          faceValue: sanitizeNumeric(leg1.faceValue),
          yield: sanitizeNumeric(leg1.yield),
          settlementAmount: sanitizeNumeric(leg1.settlementAmount),
          cleanPrice: sanitizeNumeric(leg1.cleanPrice),
          dirtyPrice: sanitizeNumeric(leg1.dirtyPrice),
          accruedInterest: sanitizeNumeric(leg1.accruedInterest),
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
          faceValue: sanitizeNumeric(leg2.faceValue),
          yield: sanitizeNumeric(leg2.yield),
          settlementAmount: sanitizeNumeric(leg2.settlementAmount),
          cleanPrice: sanitizeNumeric(leg2.cleanPrice),
          dirtyPrice: sanitizeNumeric(leg2.dirtyPrice),
          accruedInterest: sanitizeNumeric(leg2.accruedInterest),
          currency: leg2.currency || 'LKR'
        },
        // ISIN metadata (from leg1)
        issueDate: leg1.issueDate || null,
        maturityDate: leg1.maturityDate || null,
        couponRate: sanitizeNumeric(leg1.couponRate),
        couponDate1: leg1.couponDate1,
        couponDate2: leg1.couponDate2,
        // Status and tracking
        deal_status: 'Pending_Verification',
        created_by: req.user?.id || 1, // TODO: Get from auth middleware
        notes: req.body.notes || null,
        source_buy_deal_number: source_buy_deal_number || null
      };

      const result = await BuybackDeal.create(dealData);
      // Important: buyback-linked GSec leg 2 is created only after final authorization (status=Approved).
      
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
      const buybackIdNum = Number(id);
      const [buybackLinkColRows] = await db.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'gsec'
           AND COLUMN_NAME = 'buyback_deal_id'
         LIMIT 1`
      );
      const hasBuybackDealId = Array.isArray(buybackLinkColRows) && buybackLinkColRows.length > 0;

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

      // When a buyback is rejected, cancel the auto-created GSec leg 2 deal
      if (status === 'Rejected') {
        try {
          const [buybackDeals] = await db.query('SELECT * FROM buyback_deals WHERE id = ?', [id]);
          if (buybackDeals && buybackDeals.length > 0) {
            const bb = buybackDeals[0];
            if (bb.leg2_transaction_type === 'Buy' && bb.leg2_isin && bb.leg2_face_value) {
              const [gsecRows] = hasBuybackDealId
                ? await db.query(
                    `SELECT id, deal_number FROM gsec
                     WHERE transaction_type = 'Buy'
                       AND buyback_deal_id = ?
                       AND status = 'final_approved'
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [buybackIdNum]
                  )
                : await db.query(
                    `SELECT id, deal_number FROM gsec
                     WHERE transaction_type = 'Buy'
                       AND isin_number = ?
                       AND face_value = ?
                       AND value_date = ?
                       AND portfolio = ?
                       AND status = 'final_approved'
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [bb.leg2_isin, bb.leg2_face_value, bb.leg2_value_date, bb.leg2_portfolio]
                  );
              if (gsecRows && gsecRows.length > 0) {
                const gsecId = gsecRows[0].id;
                const gsecDealNumber = gsecRows[0].deal_number;
                await db.query(
                  "UPDATE gsec SET status = 'cancelled', per_day_accrual = 0 WHERE id = ?",
                  [gsecId]
                );
                console.log(
                  `Cancelled auto-created GSec deal ${gsecDealNumber} (id=${gsecId}) for rejected buyback ${bb.deal_number}`
                );
              }
            }
          }
        } catch (cleanupErr) {
          console.error('Error cancelling GSec deal for rejected buyback:', cleanupErr);
        }
      }

      // Process face value deduction when deal is approved
      if (status === 'Approved') {
        try {
          // Get the buyback deal details
          const [buybackDeals] = await db.query('SELECT * FROM buyback_deals WHERE id = ?', [id]);
          if (buybackDeals && buybackDeals.length > 0) {
            const buybackDeal = buybackDeals[0];

            // Create GSec only at final authorization for leg2 Buy, with duplicate guard
            if (buybackDeal.leg2_transaction_type === 'Buy') {
              const [existing] = hasBuybackDealId
                ? await db.query(
                    `SELECT id, deal_number FROM gsec
                     WHERE transaction_type = 'Buy'
                       AND status = 'final_approved'
                       AND buyback_deal_id = ?
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [buybackIdNum]
                  )
                : await db.query(
                    `SELECT id, deal_number FROM gsec
                     WHERE transaction_type = 'Buy'
                       AND status = 'final_approved'
                       AND isin_number = ?
                       AND face_value = ?
                       AND value_date = ?
                       AND portfolio = ?
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [
                      buybackDeal.leg2_isin,
                      buybackDeal.leg2_face_value,
                      buybackDeal.leg2_value_date,
                      buybackDeal.leg2_portfolio
                    ]
                  );

              if (!existing || existing.length === 0) {
                const [isinData] = await db.query(
                  'SELECT * FROM isin_master WHERE isin_number = ?',
                  [buybackDeal.leg2_isin]
                );

                if (isinData && isinData.length > 0) {
                  const isin = isinData[0];
                  const issueDate = buybackDeal.issue_date || isin.issue_date;
                  const maturityDate = buybackDeal.maturity_date || isin.maturity_date;
                  const couponDate1 = buybackDeal.coupon_date1 || isin.coupon_date_1;
                  const couponDate2 = buybackDeal.coupon_date2 || isin.coupon_date_2;

                  const [couponSchedule] = await db.query(
                    'SELECT * FROM isin_coupon_schedule WHERE isin = ? ORDER BY coupon_date ASC',
                    [buybackDeal.leg2_isin]
                  );

                  let lastCouponDate = null;
                  let nextCouponDate = null;
                  if (couponSchedule && couponSchedule.length > 0 && buybackDeal.leg2_value_date) {
                    const valueDateObj = new Date(buybackDeal.leg2_value_date);
                    for (let i = 0; i < couponSchedule.length; i++) {
                      const couponDate = new Date(couponSchedule[i].coupon_date);
                      if (couponDate <= valueDateObj) lastCouponDate = couponSchedule[i].coupon_date;
                      if (couponDate > valueDateObj) {
                        nextCouponDate = couponSchedule[i].coupon_date;
                        break;
                      }
                    }
                  }

                  const couponRate = buybackDeal.coupon_rate || isin.coupon_rate || 0;
                  const couponInterest =
                    (parseFloat(buybackDeal.leg2_face_value || 0) * parseFloat(couponRate || 0)) / 100;

                  let numberOfDaysInterestAccrued = null;
                  let numberOfDaysForCouponPeriod = null;
                  if (lastCouponDate && nextCouponDate && buybackDeal.leg2_value_date) {
                    const lastDate = new Date(lastCouponDate);
                    const nextDate = new Date(nextCouponDate);
                    const valueDate = new Date(buybackDeal.leg2_value_date);
                    numberOfDaysInterestAccrued = Math.floor((valueDate - lastDate) / (1000 * 60 * 60 * 24));
                    numberOfDaysForCouponPeriod = Math.floor((nextDate - lastDate) / (1000 * 60 * 60 * 24));
                  }

                  const gsecDealData = {
                    tradeType: buybackDeal.leg2_trade_type || 'BuyBack',
                    transactionType: 'Buy',
                    counterparty: buybackDeal.leg2_counterparty,
                    broker: buybackDeal.leg1_broker || null,
                    dealNumber: null,
                    isin: buybackDeal.leg2_isin,
                    faceValue: buybackDeal.leg2_face_value,
                    valueDate: buybackDeal.leg2_value_date,
                    nextCouponDate: nextCouponDate,
                    lastCouponDate: lastCouponDate,
                    numberOfDaysInterestAccrued,
                    numberOfDaysForCouponPeriod,
                    accruedInterest: buybackDeal.leg2_accrued_interest || null,
                    couponInterest: couponInterest,
                    cleanPrice: buybackDeal.leg2_clean_price,
                    dirtyPrice: buybackDeal.leg2_dirty_price,
                    accruedInterestCalculation: buybackDeal.leg2_accrued_interest || null,
                    accruedInterestSixDecimals: null,
                    accruedInterestFor100: null,
                    accruedInterestBase: null,
                    settlementAmount: buybackDeal.leg2_settlement_amount,
                    settlementMode: buybackDeal.leg2_settlement_mode,
                    issueDate: issueDate,
                    maturityDate: maturityDate,
                    couponDates:
                      couponDate1 && couponDate2 ? `${couponDate1},${couponDate2}` : `${couponDate1 || ''},${couponDate2 || ''}`,
                    yield: buybackDeal.leg2_yield_rate,
                    brokerage: buybackDeal.leg1_brokerage || 0,
                    currency: buybackDeal.leg2_currency || 'LKR',
                    portfolio: buybackDeal.leg2_portfolio,
                    strategy: buybackDeal.leg2_strategy,
                    accruedInterestAdjustment: null,
                    cleanPriceAdjustment: null,
                    custodian: buybackDeal.leg2_custodian,
                    tradeDate: buybackDeal.leg2_trade_date || buybackDeal.leg2_value_date,
                    userId: req.user?.id || 1,
                    current_approval_level: null,
                    status: 'final_approved'
                  };

                  const gsecResult = await Gsec.create(gsecDealData);
                  if (hasBuybackDealId && gsecResult && gsecResult.insertId) {
                    await db.query('UPDATE gsec SET buyback_deal_id = ? WHERE id = ?', [
                      buybackIdNum,
                      gsecResult.insertId
                    ]);
                  }
                  console.log(
                    `Created GSec leg2 deal on buyback final approval. buyback=${buybackDeal.deal_number}, gsecId=${gsecResult.insertId}`
                  );
                } else {
                  console.warn(
                    `ISIN master data not found for ${buybackDeal.leg2_isin}; skipped GSec creation on approval`
                  );
                }
              } else {
                console.log(
                  `GSec leg2 already exists for buyback ${buybackDeal.deal_number}: ${existing[0].deal_number}`
                );
              }
            }
            
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
                    WHERE isin_number = ? AND portfolio = ? AND transaction_type = 'Buy' 
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

      // Only rejected deals are editable; edited deals are re-submitted for verification
      const existingDeal = await BuybackDeal.getById(id);
      if (!existingDeal) {
        return res.status(404).json({
          success: false,
          error: 'Buyback deal not found'
        });
      }

      if (String(existingDeal.deal_status || '').toLowerCase() !== 'rejected') {
        return res.status(400).json({
          success: false,
          error: 'Only rejected deals can be edited'
        });
      }

      // Holiday validation - check if updated transaction dates are holidays
      // Check both legs for holidays
      const currency1 = leg1.currency || 'LKR';
      const currency2 = leg2.currency || 'LKR';
      
      // Check leg1 dates
      const holidayValidation1 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg1.tradeDate,
        valueDate: leg1.valueDate,
        currency: currency1
      });

      if (holidayValidation1.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 1: ${holidayValidation1.message}`
        });
      }

      // Check leg2 dates
      const holidayValidation2 = await holidayValidationService.validateTransactionDates({
        tradeDate: leg2.tradeDate,
        valueDate: leg2.valueDate,
        currency: currency2
      });

      if (holidayValidation2.isHoliday) {
        return res.status(400).json({
          success: false,
          error: 'Transaction cannot be saved on a holiday',
          message: `Leg 2: ${holidayValidation2.message}`
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
        notes: req.body.notes,
        // Re-submit edited rejected deals into the approval pipeline
        deal_status: 'Pending_Verification'
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
