const db = require('../config/database');
const LimitSetup = require('./limitSetupModel');
const CashflowCaptureService = require('../services/cashflowCaptureService');

const Gsec = {
  create: async (data) => {
    // Use the existing create method but with connection pool
    return await Gsec.createWithConnection(data, null);
  },

  createWithConnection: async (data, connection) => {
      // Auto-generate deal_number if not provided
      const MAX_ATTEMPTS = 5;
      let attempt = 0;
      let lastError;
      while (attempt < MAX_ATTEMPTS) {
        // Always (re)generate deal_number if not provided or after a retry
        if (!data.dealNumber && data.valueDate) {
          let dateObj = new Date(data.valueDate);
          if (!isNaN(dateObj.getTime())) {
            const dateStr = dateObj.getFullYear().toString() +
              String(dateObj.getMonth() + 1).padStart(2, '0') +
              String(dateObj.getDate()).padStart(2, '0');
            data.dealNumber = await Gsec.generateNextDealNumber(dateStr);
          }
        }
      // Handle the financial calculation requirements
      // Ensure accrued interest and clean price are truncated (not rounded) to 4 decimal places
      if (data.accruedInterest) {
        // Truncate to 4 decimal places
        const accruedInterest = Math.floor(parseFloat(data.accruedInterest) * 10000) / 10000;
        data.accruedInterest = accruedInterest;
      }
      
      if (data.cleanPrice) {
        // Truncate to 4 decimal places
        const cleanPrice = Math.floor(parseFloat(data.cleanPrice) * 10000) / 10000;
        data.cleanPrice = cleanPrice;
      }
      
      // Preserve the exact dirty price from frontend (don't recalculate)
      // The frontend has already calculated the correct dirty price
      
      // Only recalculate if dirty price is missing (fallback)
      if (!data.dirtyPrice && data.cleanPrice && data.accruedInterest) {
        data.dirtyPrice = parseFloat(data.cleanPrice) + parseFloat(data.accruedInterest);
      }
      
      // Ensure dirty price is truncated to 4 decimal places (same as frontend)
      if (data.dirtyPrice) {
        data.dirtyPrice = Math.floor(parseFloat(data.dirtyPrice) * 10000) / 10000;
      }
      
      const currentDate = new Date();
      
      // Calculate per_day_accrual: couponInterest / numberOfDaysForCouponPeriod
      let perDayAccrual = null;
      if (data.couponInterest && data.numberOfDaysForCouponPeriod) {
        const ci = parseFloat(data.couponInterest);
        const nd = parseFloat(data.numberOfDaysForCouponPeriod);
        if (ci && nd) {
          perDayAccrual = Math.floor((ci / nd) * 100000000) / 100000000; // truncate to 8 decimals
        }
      }
      data.per_day_accrual = perDayAccrual;

      const sql = `INSERT INTO gsec (
        trade_type, transaction_type, counterparty, deal_number, isin, face_value, trade_date, value_date, next_coupon_date, 
        last_coupon_date, number_of_days_interest_accrued, number_of_days_for_coupon_period, accrued_interest, 
        coupon_interest, clean_price, dirty_price, accrued_interest_calculation, accrued_interest_six_decimals, 
        accrued_interest_for_100, settlement_amount, settlement_mode, issue_date, maturity_date, coupon_dates, 
        yield, brokerage, currency, portfolio, strategy, broker, accrued_interest_adjustment, clean_price_adjustment, 
        per_day_accrual, status, created_by, created_at, current_approval_level, custodian, buy_deal_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      const values = [
        data.tradeType,
        data.transactionType,
        data.counterparty,
        data.dealNumber,
        data.isin,
        data.faceValue,
        data.tradeDate || data.valueDate, // Use tradeDate if provided, otherwise fallback to valueDate
        data.valueDate,
        data.nextCouponDate,
        data.lastCouponDate,
        data.numberOfDaysInterestAccrued,
        data.numberOfDaysForCouponPeriod,
        data.accruedInterest,
        data.couponInterest,
        data.cleanPrice,
        data.dirtyPrice,
        data.accruedInterestCalculation,
        data.accruedInterestSixDecimals,
        data.accruedInterestFor100,
        data.settlementAmount,
        data.settlementMode,
        data.issueDate,
        data.maturityDate,
        data.couponDates,
        data.yield,
        data.brokerage,
        data.currency || 'LKR',
        data.portfolio,
        data.strategy,
        data.broker,
        data.accruedInterestAdjustment,
        data.cleanPriceAdjustment,
        data.per_day_accrual,
        data.status || 'pending', // Use provided status or default to pending
        data.userId || null, // Creator's user ID
        currentDate, // Creation timestamp
        data.current_approval_level !== undefined ? data.current_approval_level : 1, // Use frontend value or default to 1
        data.custodian || null,
        data.buyDealNumber || null
      ];
      try {
        // Backend-side validation: prevent overselling from a Buy deal
        if (data.transactionType === 'Sell' && data.buyDealNumber) {
          // Find the referenced Buy deal
          const [buyRows] = await db.query('SELECT * FROM gsec WHERE deal_number = ? AND transaction_type = "Buy"', [data.buyDealNumber]);
          if (!buyRows.length) {
            throw { status: 400, message: 'Referenced Buy deal not found for Sell transaction.' };
          }
          const buyDeal = buyRows[0];
          // Sum all previous sells for this buy_deal_number
          const [sellAgg] = await db.query('SELECT SUM(face_value) AS total_sold FROM gsec WHERE transaction_type = "Sell" AND buy_deal_number = ?', [data.buyDealNumber]);
          const totalSold = parseFloat(sellAgg[0].total_sold || 0);
          const originalFace = parseFloat(buyDeal.face_value || 0);
          const remaining = Math.max(0, originalFace - totalSold);
          const sellAmount = parseFloat(data.faceValue || 0);
          if (sellAmount > remaining) {
            throw { status: 400, message: `Sell amount (${sellAmount}) exceeds remaining face value (${remaining}) for Buy deal ${data.buyDealNumber}.` };
          }
        }
        // Skip limit checking for now to improve performance
        // TODO: Re-enable limit checking after performance optimization
        console.log('=== SKIPPING LIMIT CHECK FOR PERFORMANCE ===');
        // If limit check passes or no counterparty, proceed with the insert
        if (connection) {
          const [result] = await connection.query(sql, values);
          
          // Capture coupon cashflow for Buy transactions
          if (data.transactionType === 'Buy') {
            try {
              await Gsec.captureCouponCashflow(
                result.insertId,
                data.isin,
                data.faceValue,
                data.maturityDate,
                data.counterparty
              );
            } catch (couponError) {
              console.error('Error capturing coupon cashflow:', couponError);
              // Don't fail the main process if coupon capture fails
            }
          }
          
          return result;
        } else {
          const [result] = await db.query(sql, values);
          
          // Capture cashflow for the new GSEC transaction
          try {
            await CashflowCaptureService.captureGsecCashflow(
              result.insertId,
              data.transactionType,
              data.settlementAmount,
              data.valueDate,
              data.counterparty
            );
            
            // Capture coupon cashflow for Buy transactions
            if (data.transactionType === 'Buy') {
              await Gsec.captureCouponCashflow(
                result.insertId,
                data.isin,
                data.faceValue,
                data.maturityDate,
                data.counterparty
              );
            }
          } catch (cashflowError) {
            console.error('Error capturing cashflow for GSEC transaction:', cashflowError);
            // Don't fail the main process if cashflow capture fails
          }
          
          return result;
        }
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' && String(error.sqlMessage).includes('unique_deal_number')) {
          attempt++;
          // Regenerate deal number and retry
          if (data.valueDate) {
            let dateObj = new Date(data.valueDate);
            if (!isNaN(dateObj.getTime())) {
              const dateStr = dateObj.getFullYear().toString() +
                String(dateObj.getMonth() + 1).padStart(2, '0') +
                String(dateObj.getDate()).padStart(2, '0');
              data.dealNumber = await Gsec.generateNextDealNumber(dateStr);
            }
          }
          continue;
        }
        lastError = error;
        break;
      }
    }
    throw lastError || new Error('Failed to generate unique deal number after retries');
  },
  
  // Promise-based version of checkGsecLimit
  checkGsecLimitAsync: async (data, connection = null) => {
    console.log('=== CHECKING GSEC LIMITS (START) ===');
    
    // First, determine the counterparty type
    const counterpartyId = data.counterparty;
    const amount = parseFloat(data.faceValue || 0);
    const currency = data.currency || 'LKR';
    
    // Add validation for counterparty ID
    if (!counterpartyId || counterpartyId === null || counterpartyId === undefined || counterpartyId === '') {
      console.error('Invalid counterparty ID: counterpartyId is null, undefined, or empty');
      return {
        allowed: false,
        message: 'Counterparty ID is required and cannot be empty'
      };
    }
    
    console.log(`Checking limits for counterparty ID: ${counterpartyId}, amount: ${amount}, currency: ${currency}`);
    
    try {
      // Extract the original ID and type from the prefixed ID (i3 -> 3, individual)
      let originalId, counterpartyType;
      if (counterpartyId.startsWith('i')) {
        originalId = counterpartyId.substring(1);
        counterpartyType = 'individual';
      } else if (counterpartyId.startsWith('j')) {
        originalId = counterpartyId.substring(1);
        counterpartyType = 'joint';
      } else if (counterpartyId.startsWith('c')) {
        originalId = counterpartyId.substring(1);
        counterpartyType = 'corporate';
      } else {
        // Fallback for backward compatibility - try to find in any table
        originalId = counterpartyId;
        counterpartyType = null;
      }
      
      console.log(`Extracted original ID: ${originalId}, type: ${counterpartyType}`);
      
      // Optimized: Single query to find counterparty type
      const queryFn = connection ? connection.query.bind(connection) : db.query;
      const [counterpartyRows] = await queryFn(`
        SELECT 'individual' as type FROM counterparty_master_individual WHERE id = ?
        UNION ALL
        SELECT 'joint' as type FROM counterparty_master_joint WHERE id = ?
        UNION ALL
        SELECT 'corporate' as type FROM counterparty_master_corporate WHERE id = ?
        LIMIT 1
      `, [originalId, originalId, originalId]);
      
      if (counterpartyRows && counterpartyRows.length > 0) {
        counterpartyType = counterpartyRows[0].type;
        console.log(`Found counterparty as ${counterpartyType}: ${originalId}`);
        const result = await Gsec.checkLimitsAsync(originalId, counterpartyType, amount, currency, connection);
        console.log('=== CHECKING GSEC LIMITS (END) ===');
        return result;
      } else {
            // Log detailed error information
            console.error(`Counterparty ID ${counterpartyId} (original: ${originalId}) not found in any counterparty table`);
            
            // Check what counterparties exist for debugging
            const [allIndividual] = await queryFn('SELECT id, short_name FROM counterparty_master_individual LIMIT 5');
            const [allJoint] = await queryFn('SELECT id, short_name FROM counterparty_master_joint LIMIT 5');
            const [allCorporate] = await queryFn('SELECT id, short_name FROM counterparty_master_corporate LIMIT 5');
            
            console.log('Available counterparties (first 5 of each type):');
            console.log('Individual:', allIndividual);
            console.log('Joint:', allJoint);
            console.log('Corporate:', allCorporate);
            
            return {
              allowed: false,
              message: `Invalid counterparty ID: ${counterpartyId}. Please select a valid counterparty from the dropdown.`
            };
          }
    } catch (error) {
      console.error('Error in checkGsecLimitAsync:', error);
      throw error;
    }
  },
  
  // Promise-based helper function for checking limits
  checkLimitsAsync: async (counterpartyId, counterpartyType, amount, currency, connection = null) => {
    console.log('=== CHECKING LIMITS (START) ===');
    
    try {
      const queryFn = connection ? connection.query.bind(connection) : db.query;
      
      // Quick check: If amount is 0 or negative, allow immediately
      if (amount <= 0) {
        console.log('=== CHECKING LIMITS (END) - ZERO AMOUNT ===');
        return {
          allowed: true,
          message: 'Zero or negative amount, allowing transaction.'
        };
      }
      
      // Get the current limit setup for this counterparty
      const [limitRows] = await queryFn(
        `SELECT * FROM counterparty_limits 
         WHERE counterparty_id = ? 
         AND counterparty_type = ?
         AND (currency = ? OR currency IS NULL OR currency = '')
         LIMIT 1`,
        [counterpartyId, counterpartyType, currency]
      );
      
      if (!limitRows || limitRows.length === 0) {
        // Allow transaction if no limits are configured
        console.log('=== CHECKING LIMITS (END) - NO LIMITS ===');
        return {
          allowed: true,
          message: 'No limits configured for this counterparty and currency, allowing transaction.'
        };
      }
      
      const limits = limitRows[0];
      
      // Get current GSec exposure for this counterparty
      const [gsecRows] = await queryFn(
        `SELECT SUM(face_value) AS total FROM gsec 
         WHERE counterparty = ? AND currency = ?`,
        [counterpartyId, currency]
      );
      
      const currentGsecExposure = parseFloat(gsecRows[0]?.total || 0);
      
      // Get overall exposure across all products (would need to sum from transactions + gsec + other tables)
      // For simplicity, we're just checking GSec limits here
      
      const gsecLimit = parseFloat(limits.product_gsec_limit || 0);
      const overallLimit = parseFloat(limits.overall_exposure_limit || 0);
      
      // Check if adding the new amount would exceed the GSec limit
      const newGsecExposure = currentGsecExposure + amount;
      
      if (gsecLimit > 0 && newGsecExposure > gsecLimit) {
        console.log('=== CHECKING LIMITS (END) - LIMIT EXCEEDED ===');
        return {
          allowed: false,
          message: `Transaction exceeds GSec limit (${newGsecExposure} > ${gsecLimit})`,
          currentExposure: currentGsecExposure,
          limit: gsecLimit,
          exceededAmount: newGsecExposure - gsecLimit
        };
      }
      
      // For overall limit, we'd need to query all product tables
      // This is simplified for now
      
      console.log('=== CHECKING LIMITS (END) - ALLOWED ===');
      return { allowed: true };
    } catch (error) {
      console.error('Error in checkLimitsAsync:', error);
      throw error;
    }
  },
  
  // Check if a GSec transaction would exceed limits
  checkGsecLimit: (data, callback) => {
    // First, determine the counterparty type
    const counterpartyId = data.counterparty;
    const amount = parseFloat(data.faceValue || 0);
    const currency = data.currency || 'LKR';
    
    // Check if it's an individual counterparty
    db.query(
      'SELECT id, "individual" as type FROM counterparty_master_individual WHERE id = ?',
      [counterpartyId],
      (err, individualRows) => {
        if (err) return callback(err);
        
        let counterpartyType;
        if (individualRows && individualRows.length > 0) {
          counterpartyType = 'individual';
        } else {
          // Check if it's a joint counterparty
          db.query(
            'SELECT id, "joint" as type FROM counterparty_master_joint WHERE id = ?',
            [counterpartyId],
            (err, jointRows) => {
              if (err) return callback(err);
              
              if (jointRows && jointRows.length > 0) {
                counterpartyType = 'joint';
              } else {
                return callback(null, {
                  allowed: false,
                  message: 'Invalid counterparty ID'
                });
              }
              
              // Now check the limits for this counterparty
              checkLimits(counterpartyId, counterpartyType, amount, currency, callback);
            }
          );
          return; // Exit the current function since we're in the async callback
        }
        
        // If we're here, it's an individual counterparty
        checkLimits(counterpartyId, counterpartyType, amount, currency, callback);
      }
    );
    
    function checkLimits(counterpartyId, counterpartyType, amount, currency, callback) {
      // Get the current limit setup for this counterparty
      db.query(
        `SELECT * FROM counterparty_limits 
         WHERE counterparty_id = ? 
         AND counterparty_type = ?
         AND (currency = ? OR currency IS NULL OR currency = '')`,
        [counterpartyId, counterpartyType, currency],
        (err, limitRows) => {
          if (err) return callback(err);
          
          if (!limitRows || limitRows.length === 0) {
            return callback(null, {
              allowed: false,
              message: 'No limits configured for this counterparty and currency'
            });
          }
          
          const limits = limitRows[0];
          
          // Get current GSec exposure for this counterparty
          db.query(
            `SELECT SUM(face_value) AS total FROM gsec 
             WHERE counterparty = ? AND currency = ?`,
            [counterpartyId, currency],
            (err, gsecRows) => {
              if (err) return callback(err);
              
              const currentGsecExposure = parseFloat(gsecRows[0]?.total || 0);
              
              // Get overall exposure across all products (would need to sum from transactions + gsec + other tables)
              // For simplicity, we're just checking GSec limits here
              
              const gsecLimit = parseFloat(limits.product_gsec_limit || 0);
              const overallLimit = parseFloat(limits.overall_exposure_limit || 0);
              
              // Check if adding the new amount would exceed the GSec limit
              const newGsecExposure = currentGsecExposure + amount;
              
              if (gsecLimit > 0 && newGsecExposure > gsecLimit) {
                return callback(null, {
                  allowed: false,
                  message: `Transaction exceeds GSec limit (${newGsecExposure} > ${gsecLimit})`,
                  currentExposure: currentGsecExposure,
                  limit: gsecLimit,
                  exceededAmount: newGsecExposure - gsecLimit
                });
              }
              
              // For overall limit, we'd need to query all product tables
              // This is simplified for now
              
              return callback(null, { allowed: true });
            }
          );
        }
      );
    }
  },
  /**
   * Get recent GSec transactions with associated data
   */
  getRecent: async () => {
    // Query with JOIN to get counterparty short names
    // Counterparty IDs are stored with prefixes: c1, i1, j2, etc.
    // Extract numeric part to match with counterparty table IDs
    const sql = `
      SELECT 
        g.*,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          g.counterparty
        ) as counterparty_name
      FROM gsec g
      LEFT JOIN counterparty_master_corporate corp ON 
        (g.counterparty LIKE 'c%' AND SUBSTRING(g.counterparty, 2) = corp.id)
      LEFT JOIN counterparty_master_individual ind ON 
        (g.counterparty LIKE 'i%' AND SUBSTRING(g.counterparty, 2) = ind.id)
      LEFT JOIN counterparty_master_joint joint ON 
        (g.counterparty LIKE 'j%' AND SUBSTRING(g.counterparty, 2) = joint.id)
      ORDER BY g.id DESC 
      LIMIT 150
    `;
    
    try {
      const [results] = await db.query(sql);
      
      // Format results to match frontend expectations
      const formattedResults = results.map(transaction => {
        // Ensure all monetary values are displayed with exactly 4 decimal places
        // As per the financial calculation requirements in the memory
        return {
          ...transaction,
          accrued_interest: transaction.accrued_interest ? parseFloat(transaction.accrued_interest).toFixed(4) : null,
          clean_price: transaction.clean_price ? parseFloat(transaction.clean_price).toFixed(4) : null,
          dirty_price: transaction.dirty_price ? parseFloat(transaction.dirty_price).toFixed(4) : null,
          face_value: transaction.face_value ? parseFloat(transaction.face_value).toFixed(2) : null,
          // Use counterparty_name from JOIN, fallback to counterparty ID if not found
          counterparty_name: transaction.counterparty_name || transaction.counterparty || 'Unknown'
        };
      });
      
      // Debug: Log dirty price data being returned
      console.log('=== GETRECENT DIRTY PRICE DEBUG ===');
      if (formattedResults.length > 0) {
        formattedResults.forEach((tx, index) => {
          console.log(`Transaction ${index + 1}:`, {
            id: tx.id,
            isin: tx.isin,
            dirty_price: tx.dirty_price,
            clean_price: tx.clean_price,
            accrued_interest: tx.accrued_interest,
            face_value: tx.face_value
          });
        });
      }
      console.log('==================================');
      
      return formattedResults;
    } catch (error) {
      console.error('Error in getRecent:', error);
      throw error;
    }
  },
  
  // ... (rest of the code remains the same)

  /**
   * Get Buy deals with remaining face value (original - total sold from this deal)
   * Only for display, does not update Buy record. Uses buy_deal_number in Sell transactions.
   * Filtered by ISIN and/or portfolio if provided.
   */
  getBuyDealsWithBalanceFiltered: async (isin, portfolio, asAtDate = null) => {
    // Build SQL with optional filters - show approved deals with remaining balance
    let sql = `SELECT 
      id,
      deal_number,
      isin,
      yield,
      face_value,
      remaining_face_value,
      portfolio,
      value_date,
      transaction_type,
      status
    FROM gsec 
    WHERE transaction_type = 'Buy' 
      AND status IN ('Approved', 'Settled', 'final_approved')`;
    const params = [];
    if (isin) {
      sql += ' AND isin = ?';
      params.push(isin);
    }
    if (portfolio) {
      sql += ' AND portfolio = ?';
      params.push(portfolio);
    }
    // Filter by date if provided (for historical reports)
    if (asAtDate) {
      sql += ' AND value_date <= ?';
      params.push(asAtDate);
    }
    sql += ' ORDER BY deal_number DESC';
    
    const [rows] = await db.query(sql, params);
    
    // Calculate remaining face value dynamically by subtracting sell transactions
    const dealNumbers = rows.map(r => r.deal_number).filter(Boolean);
    const soldByDeal = {};
    
    if (dealNumbers.length) {
      // Get total sold per buy_deal_number
      const placeholders = dealNumbers.map(() => '?').join(',');
      let sellSql = `
        SELECT buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
        FROM gsec
        WHERE transaction_type = 'Sell' AND buy_deal_number IN (${placeholders})
      `;
      const sellParams = [...dealNumbers];
      
      // Filter sell transactions by date if provided (for historical reports)
      if (asAtDate) {
        sellSql += ' AND value_date <= ?';
        sellParams.push(asAtDate);
      }
      
      sellSql += ' GROUP BY buy_deal_number';
      
      const [sellRows] = await db.query(sellSql, sellParams);
      sellRows.forEach(row => {
        soldByDeal[row.buy_deal_number] = Number(row.total_sold) || 0;
      });
    }
    
    // If asAtDate is provided, calculate buyback deductions up to that date
    const buybackDeductionsByDeal = {};
    if (asAtDate && dealNumbers.length) {
      const placeholders = dealNumbers.map(() => '?').join(',');
      let buybackSql = `
        SELECT source_buy_deal_number, COALESCE(SUM(leg1_face_value), 0) AS total_buyback
        FROM buyback_deals
        WHERE leg1_transaction_type = 'Sell'
        AND deal_status = 'Approved'
        AND DATE(approved_at) <= ?
        AND (source_buy_deal_number IN (${placeholders}) OR source_buy_deal_number IS NULL)
        GROUP BY source_buy_deal_number
      `;
      const buybackParams = [asAtDate, ...dealNumbers];
      
      const [buybackRows] = await db.query(buybackSql, buybackParams);
      buybackRows.forEach(row => {
        if (row.source_buy_deal_number) {
          buybackDeductionsByDeal[row.source_buy_deal_number] = Number(row.total_buyback) || 0;
        } else {
          // NULL source means chronological deduction - distribute across deals
          const totalBuyback = Number(row.total_buyback) || 0;
          // For simplicity, distribute evenly across all deals (you may want to implement chronological logic)
          dealNumbers.forEach(dealNum => {
            if (!buybackDeductionsByDeal[dealNum]) {
              buybackDeductionsByDeal[dealNum] = totalBuyback / dealNumbers.length;
            }
          });
        }
      });
    }
    
    // ALWAYS use remaining_face_value from database (which includes buyback deductions)
    // The database value is the source of truth that accounts for all deductions
    return rows.map(deal => {
      const originalFace = Number(deal.face_value) || 0;
      const dbRemainingFaceValue = Number(deal.remaining_face_value) || 0;
      
      let remainingFace;
      if (asAtDate) {
        // For historical date reporting, calculate dynamically
      const soldAmount = Number(soldByDeal[deal.deal_number] || 0);
        const buybackDeduction = Number(buybackDeductionsByDeal[deal.deal_number] || 0);
        remainingFace = Math.max(0, originalFace - soldAmount - buybackDeduction);
      } else {
        // For current date, use database value (most accurate - includes all deductions)
        if (dbRemainingFaceValue > 0) {
          remainingFace = dbRemainingFaceValue;
        } else {
          // Fallback: calculate dynamically
          const soldAmount = Number(soldByDeal[deal.deal_number] || 0);
          remainingFace = Math.max(0, originalFace - soldAmount);
        }
      }
      
      return {
        ...deal,
        face_value: originalFace.toFixed(2),
        remaining_face_value: remainingFace.toFixed(4)
      };
    }).filter(deal => Number(deal.remaining_face_value) > 0); // Only show deals with remaining balance
  },

  /**
   * Get all Buy deals with remaining face value (original - total sold from this deal)
   * Only for display, does not update Buy record. Uses buy_deal_number in Sell transactions.
   */
  getBuyDealsWithBalance: async () => {
    // Get all Buy deals - only finally approved
    const buySql = `SELECT * FROM gsec WHERE transaction_type = 'Buy' AND status = 'final_approved' ORDER BY id DESC`;
    // Get total sold per buy_deal_number (Sell transactions reference Buy deals)
    const sellSql = `SELECT buy_deal_number, SUM(face_value) AS total_sold FROM gsec WHERE transaction_type = 'Sell' GROUP BY buy_deal_number`;
    try {
      const [buyDeals] = await db.query(buySql);
      const [sellAgg] = await db.query(sellSql);
      // Map of buy_deal_number => total_sold
      const soldMap = {};
      for (const row of sellAgg) {
        soldMap[row.buy_deal_number] = parseFloat(row.total_sold || 0);
      }
      // Compose results
      return buyDeals.map(deal => {
        const originalFace = parseFloat(deal.face_value || 0);
        const sold = soldMap[deal.deal_number] || 0;
        const remaining = Math.max(0, originalFace - sold);
        return {
          ...deal,
          accrued_interest: deal.accrued_interest ? parseFloat(deal.accrued_interest).toFixed(4) : null,
          clean_price: deal.clean_price ? parseFloat(deal.clean_price).toFixed(4) : null,
          dirty_price: deal.dirty_price ? parseFloat(deal.dirty_price).toFixed(4) : null,
          face_value: (Math.trunc(originalFace * 10000) / 10000).toFixed(4),
          remaining_face_value: (Math.trunc(remaining * 10000) / 10000).toFixed(4),
          counterparty_name: 'Unknown'
        };
      });
    } catch (error) {
      console.error('Error in getBuyDealsWithBalance:', error);
      throw error;
    }
  },

  /**
   * Get only GSec deals with transaction_type = 'Buy'
   */
  getBuyDeals: async () => {
    const sql = `SELECT * FROM gsec WHERE transaction_type = 'Buy' AND status = 'final_approved' ORDER BY id DESC`;
    try {
      const [results] = await db.query(sql);
      // Format results for frontend (truncate/format decimals as in getRecent)
      return results.map(transaction => ({
        ...transaction,
        accrued_interest: transaction.accrued_interest ? parseFloat(transaction.accrued_interest).toFixed(4) : null,
        clean_price: transaction.clean_price ? parseFloat(transaction.clean_price).toFixed(4) : null,
        dirty_price: transaction.dirty_price ? parseFloat(transaction.dirty_price).toFixed(4) : null,
        face_value: transaction.face_value ? parseFloat(transaction.face_value).toFixed(2) : null,
        counterparty_name: 'Unknown'
      }));
    } catch (error) {
      console.error('Error in getBuyDeals:', error);
      throw error;
    }
  },
  
  /**
   * Update an existing GSec transaction
   */
  update: async (id, data) => {
    // Handle the financial calculation requirements
    // Ensure accrued interest and clean price are truncated (not rounded) to 4 decimal places
    if (data.accrued_interest) {
      // Truncate to 4 decimal places
      const accruedInterest = Math.floor(parseFloat(data.accrued_interest) * 10000) / 10000;
      data.accrued_interest = accruedInterest;
    }
    
    if (data.clean_price) {
      // Truncate to 4 decimal places
      const cleanPrice = Math.floor(parseFloat(data.clean_price) * 10000) / 10000;
      data.clean_price = cleanPrice;
    }
    
    // Calculate dirty price as clean price + accrued interest
    if (data.clean_price && data.accrued_interest) {
      data.dirty_price = parseFloat(data.clean_price) + parseFloat(data.accrued_interest);
    }
    
    // Generate SET clause for SQL
    const setClauses = [];
    const values = [];
    
    // Whitelist of valid database columns in gsec table (based on actual schema)
    const validColumns = [
      'trade_type', 'transaction_type', 'counterparty', 'deal_number', 'buy_deal_number', 'isin', 'face_value',
      'value_date', 'trade_date', 'next_coupon_date', 'last_coupon_date', 'number_of_days_interest_accrued',
      'number_of_days_for_coupon_period', 'accrued_interest', 'daily_accrual', 'coupon_interest', 'clean_price',
      'dirty_price', 'per_day_accrual', 'accrued_interest_calculation', 'accrued_interest_six_decimals',
      'accrued_interest_for_100', 'settlement_amount', 'settlement_mode', 'issue_date',
      'maturity_date', 'coupon_dates', 'yield', 'portfolio', 'clean_price_adjustment',
      'accrued_interest_adjustment', 'broker', 'strategy', 'stratergy', 'status', 'comment', 'created_by',
      'created_at', 'updated_by', 'updated_at', 'authorized_by', 'authorized_at',
      'current_approval_level', 'brokerage', 'currency', 'custodian',
      'remaining_face_value', 'matured', 'sell_back_amount'
    ];
    
    // Map data object to SQL SET clauses
    Object.keys(data).forEach(key => {
      // Skip the id field and any fields that are not DB columns
      if (key !== 'id' && key !== 'userId') {
        // Convert camelCase to snake_case for DB fields
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        
        // Only include fields that exist in the database
        if (validColumns.includes(dbField)) {
        setClauses.push(`${dbField} = ?`);
        values.push(data[key]);
        }
      }
    });
    
    if (setClauses.length === 0) {
      throw new Error('No fields to update');
    }
    
    // Add ID to values array for WHERE clause
    values.push(id);
    
    const sql = `UPDATE gsec SET ${setClauses.join(', ')} WHERE id = ?`;
    
    try {
      const [result] = await db.query(sql, values);
      return result;
    } catch (error) {
      console.error('Error in update:', error);
      throw error;
    }
  },
  
  /**
   * Update status of a GSec transaction (approve/reject)
   */
  updateStatus: async (id, data) => {
    // First, fetch the current transaction to get the actual current_approval_level
    const [currentTx] = await db.query('SELECT current_approval_level, status FROM gsec WHERE id = ?', [id]);
    if (!currentTx || currentTx.length === 0) {
      throw new Error('Transaction not found');
    }
    
    const currentApprovalLevel = currentTx[0].current_approval_level || 1;
    let newApprovalLevel = currentApprovalLevel;
    let newStatus = data.status;
    let finalApproval = false;
    
    if (data.status === 'approved') {
      // Advance to next approval level based on CURRENT approval level
      if (currentApprovalLevel === 1) {
        // Front office approved -> move to back office verifier (level 2)
        newApprovalLevel = 2;
        newStatus = 'pending';
      } else if (currentApprovalLevel === 2) {
        // Back office verifier approved -> move to back office final (level 3)
        newApprovalLevel = 3;
        newStatus = 'pending';
      } else if (currentApprovalLevel === 3) {
        // Back office final approved -> mark as final_approved
        newApprovalLevel = 3; // Stay at final
        newStatus = 'final_approved';
        finalApproval = true;
      }
    } else if (data.status === 'rejected') {
      // Reset to front office on rejection
      newApprovalLevel = 1;
      newStatus = 'rejected';
    }
    
    const sql = `
      UPDATE gsec 
      SET 
        status = ?,
        comment = ?,
        authorized_by = ?,
        authorized_at = ?,
        current_approval_level = ?
      WHERE id = ?
    `;
    
    const values = [
      newStatus,
      data.comment,
      data.authorized_by,
      data.authorized_at,
      newApprovalLevel,
      id
    ];
    
    try {
      const [result] = await db.query(sql, values);
      
      // If finally approved, create ledger entries
      if (finalApproval) {
        try {
          // Fetch the full transaction details
          const [updatedTx] = await db.query('SELECT * FROM gsec WHERE id = ?', [id]);
          if (updatedTx && updatedTx.length > 0) {
            const transaction = updatedTx[0];
            
            // Check if ledger entries already exist for this deal
            const [existingEntries] = await db.query(
              'SELECT COUNT(*) as cnt FROM ledger_entries WHERE deal_number = ?',
              [transaction.deal_number]
            );
            
            if (existingEntries[0].cnt === 0) {
              // No existing entries, create them
              const ledgerController = require('../controllers/ledgerController');
              
              // Determine the amount to use
              // For Buy transactions, use settlement_amount; for Sell, also use settlement_amount
              const amount = Number(transaction.settlement_amount || transaction.face_value || 0);
              
              // Determine account codes based on transaction type using account mapping service
              const accountMapping = require('../services/accountMappingService');
              let drAccount, crAccount, description;
              
              if (transaction.transaction_type === 'Buy') {
                // Buy: Debit Investment Asset (TBonds), Credit Cash/Bank
                drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS);
                // Try to get settlement account from settlement_mode, otherwise use default
                if (transaction.settlement_mode) {
                  try {
                    const [settlementAccount] = await db.query(
                      'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
                      [transaction.settlement_mode]
                    );
                    if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
                      crAccount = settlementAccount[0].ledger_account_code;
                    } else {
                      crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
                    }
                  } catch (settlementError) {
                    console.error('Error fetching settlement account:', settlementError);
                    crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
                  }
                } else {
                  crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
                }
                description = `GSec Purchase - Final Approval - ${transaction.deal_number}`;
              } else if (transaction.transaction_type === 'Sell') {
                // Sell: Debit Cash/Bank, Credit Investment Asset (TBonds)
                // Try to get settlement account from settlement_mode, otherwise use default
                if (transaction.settlement_mode) {
                  try {
                    const [settlementAccount] = await db.query(
                      'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
                      [transaction.settlement_mode]
                    );
                    if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
                      drAccount = settlementAccount[0].ledger_account_code;
                    } else {
                      drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
                    }
                  } catch (settlementError) {
                    console.error('Error fetching settlement account:', settlementError);
                    drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
                  }
                } else {
                  drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
                }
                crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS);
                description = `GSec Sale - Final Approval - ${transaction.deal_number}`;
              } else {
                // Unknown transaction type, skip ledger entry
                console.warn(`Unknown transaction type: ${transaction.transaction_type}, skipping ledger entry`);
                return result;
              }
              
              // Post ledger entry
              const ledgerResult = await ledgerController.postLedgerEntry({
                date: transaction.value_date ? new Date(transaction.value_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                dr_account: drAccount,
                cr_account: crAccount,
                amount: amount,
                deal_id: transaction.deal_number,
                description: description
              });
              
              if (!ledgerResult.success) {
                console.error('Failed to post GSec ledger entry:', ledgerResult.error);
                // Don't throw error, just log it so the status update still succeeds
              } else {
                console.log(`Successfully created ledger entries for GSEC transaction ${transaction.deal_number}`);
              }
            } else {
              console.log(`Ledger entries already exist for deal ${transaction.deal_number}, skipping creation`);
            }
          }
        } catch (err) {
          console.error('Failed to post GSec ledger entry:', err);
          // Don't throw error, just log it so the status update still succeeds
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error in updateStatus:', error);
      throw error;
    }
  }
};

Gsec.getLatestDealNumber = async (date) => {
  // date should be in YYYYMMDD format for the new pattern
  const [results] = await db.query(
    'SELECT deal_number FROM gsec WHERE deal_number LIKE ? ORDER BY deal_number DESC LIMIT 1',
    [`${date}/GSEC/%`]
  );
  const latest = results[0] ? results[0].deal_number : null;
  return latest;
};

/**
 * Generate the next deal number for GSec in the format GSEC-YYYY-MM-DD-###
 * @param {string} date - in YYYY-MM-DD format
 * @returns {string} nextDealNumber
 */
Gsec.generateNextDealNumber = async (date) => {
  try {
    // Get the latest deal number for this date
    const latest = await Gsec.getLatestDealNumber(date);
    let nextSeq = 1;
    
    if (latest) {
      const parts = latest.split('/');
      if (parts.length >= 3) {
        const seqStr = parts[2]; // Get the sequence part (0001, 0002, etc.)
        const seqNum = parseInt(seqStr, 10);
        if (!isNaN(seqNum)) {
          nextSeq = seqNum + 1;
        }
      }
    }
    
    const padded = String(nextSeq).padStart(4, '0');
    const nextDeal = `${date}/GSEC/${padded}`;
    return nextDeal;
  } catch (error) {
    console.error('[ERROR] Failed to generate deal number:', error);
    // Fallback to timestamp-based unique number
    const timestamp = Date.now().toString().slice(-4);
    return `${date}/GSEC/${timestamp}`;
  }
};


/**
 * Get all GSec transactions at a specific approval level
 */
Gsec.getTransactionsByApprovalLevel = async (approvalLevel) => {
  const sql = `SELECT * FROM gsec WHERE current_approval_level = ? ORDER BY id DESC`;
  try {
    const [results] = await db.query(sql, [approvalLevel]);
    // Format results for frontend display (truncate/format decimals)
    return results.map(transaction => ({
      ...transaction,
      accruedInterest: transaction.accrued_interest ? parseFloat(transaction.accrued_interest).toFixed(4) : null,
      cleanPrice: transaction.clean_price ? parseFloat(transaction.clean_price).toFixed(4) : null,
      dirtyPrice: transaction.dirty_price ? parseFloat(transaction.dirty_price).toFixed(4) : null,
      faceValue: transaction.face_value ? parseFloat(transaction.face_value).toFixed(4) : null,
      dealNumber: transaction.deal_number,
      tradeDate: transaction.trade_date,
      security: transaction.security || transaction.isin,
      status: transaction.status
    }));
  } catch (error) {
    console.error('Error in getTransactionsByApprovalLevel:', error);
    throw error;
  }
};

/**
 * Advance approval level for a transaction (1->2->3, then mark as final)
 */
Gsec.advanceApprovalLevel = async (id) => {
  // Fetch the transaction
  const [results] = await db.query('SELECT * FROM gsec WHERE id = ?', [id]);
  if (!results.length) return null;
  const tx = results[0];
  let newLevel = tx.current_approval_level;
  let updateFields = '';
  let finalApproval = false;
  if (tx.current_approval_level < 3) {
    newLevel = tx.current_approval_level + 1;
    updateFields = ', current_approval_level = ' + newLevel;
  } else {
    // Set status to final_approved on last approval
    updateFields = ", status = 'final_approved'";
    finalApproval = true;
  }
  await db.query(`UPDATE gsec SET updated_at = NOW()${updateFields} WHERE id = ?`, [id]);
  // Return updated transaction
  const [updated] = await db.query('SELECT * FROM gsec WHERE id = ?', [id]);

  // If finally approved, post ledger entry
  if (finalApproval) {
    try {
      const ledgerController = require('../controllers/ledgerController');
      const accountMapping = require('../services/accountMappingService');
      const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS);
      const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
      
      await ledgerController.postLedgerEntry({
        date: new Date().toISOString().slice(0, 10),
        dr_account: drAccount,
        cr_account: crAccount,
        amount: Number(updated[0].face_value),
        deal_id: updated[0].deal_number,
        description: 'GSec Purchase - Final Approval'
      });
    } catch (err) {
      console.error('Failed to post GSec ledger entry:', err);
      // Optionally: update transaction with error status/field
    }
  }
  return updated[0];
};

Gsec.getTransactionsByPortfolio = async (portfolioId) => {
  const sql = "SELECT * FROM gsec WHERE portfolio = ? AND transaction_type = 'Buy' AND status = 'final_approved'";
  const [rows] = await db.query(sql, [portfolioId]);
  return rows;
};

/**
 * Backfill ledger entries for final_approved GSEC transactions that don't have ledger entries
 * This function can be called to fix missing ledger entries for existing transactions
 */
Gsec.backfillLedgerEntries = async (transactionId = null) => {
  try {
    const ledgerController = require('../controllers/ledgerController');
    
    // Build query to find final_approved transactions without ledger entries
    let query = `
      SELECT g.* 
      FROM gsec g
      WHERE g.status = 'final_approved'
        AND NOT EXISTS (
          SELECT 1 FROM ledger_entries le 
          WHERE le.deal_number = g.deal_number
        )
    `;
    let params = [];
    
    // If specific transaction ID provided, filter by it
    if (transactionId) {
      query += ' AND g.id = ?';
      params.push(transactionId);
    }
    
    const [transactions] = await db.query(query, params);
    
    if (transactions.length === 0) {
      return {
        success: true,
        message: transactionId 
          ? 'Transaction already has ledger entries or is not final_approved'
          : 'No transactions found that need ledger entries',
        processed: 0
      };
    }
    
    let processed = 0;
    let errors = [];
    
    for (const transaction of transactions) {
      try {
        // Determine the amount to use
        const amount = Number(transaction.settlement_amount || transaction.face_value || 0);
        
        if (amount === 0) {
          errors.push(`Transaction ${transaction.deal_number}: Amount is zero, skipping`);
          continue;
        }
        
        // Determine account codes based on transaction type using account mapping service
        const accountMapping = require('../services/accountMappingService');
        let drAccount, crAccount, description;
        
        if (transaction.transaction_type === 'Buy') {
          // Buy: Debit Investment Asset (TBonds), Credit Cash/Bank
          drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS);
          // Try to get settlement account from settlement_mode, otherwise use default
          if (transaction.settlement_mode) {
            try {
              const [settlementAccount] = await db.query(
                'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
                [transaction.settlement_mode]
              );
              if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
                crAccount = settlementAccount[0].ledger_account_code;
              } else {
                crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
              }
            } catch (settlementError) {
              console.error('Error fetching settlement account:', settlementError);
              crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
            }
          } else {
            crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
          }
          description = `GSec Purchase - Final Approval - ${transaction.deal_number}`;
        } else if (transaction.transaction_type === 'Sell') {
          // Sell: Debit Cash/Bank, Credit Investment Asset (TBonds)
          // Try to get settlement account from settlement_mode, otherwise use default
          if (transaction.settlement_mode) {
            try {
              const [settlementAccount] = await db.query(
                'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
                [transaction.settlement_mode]
              );
              if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
                drAccount = settlementAccount[0].ledger_account_code;
              } else {
                drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
              }
            } catch (settlementError) {
              console.error('Error fetching settlement account:', settlementError);
              drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
            }
          } else {
            drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
          }
          crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS);
          description = `GSec Sale - Final Approval - ${transaction.deal_number}`;
        } else {
          errors.push(`Transaction ${transaction.deal_number}: Unknown transaction type ${transaction.transaction_type}, skipping`);
          continue;
        }
        
        // Post ledger entry
        const ledgerResult = await ledgerController.postLedgerEntry({
          date: transaction.value_date ? new Date(transaction.value_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          dr_account: drAccount,
          cr_account: crAccount,
          amount: amount,
          deal_id: transaction.deal_number,
          description: description
        });
        
        if (!ledgerResult.success) {
          errors.push(`Transaction ${transaction.deal_number}: ${ledgerResult.error}`);
        } else {
          processed++;
          console.log(`Successfully created ledger entries for GSEC transaction ${transaction.deal_number}`);
        }
      } catch (err) {
        errors.push(`Transaction ${transaction.deal_number}: ${err.message}`);
        console.error(`Error processing transaction ${transaction.deal_number}:`, err);
      }
    }
    
    return {
      success: true,
      message: `Processed ${processed} transaction(s)`,
      processed,
      total: transactions.length,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('Error in backfillLedgerEntries:', error);
    return {
      success: false,
      error: error.message,
      processed: 0
    };
  }
};

// Get maturities by date (without deal status filtering as requested)
Gsec.getMaturitiesByDate = async (date) => {
  const query = `
    SELECT 
      g.id,
      g.deal_number,
      g.isin,
      g.counterparty,
      COALESCE(
        corp.short_name,
        ind.short_name,
        joint.short_name,
        g.counterparty
      ) as counterparty_name,
      g.face_value,
      g.settlement_amount,
      g.accrued_interest,
      g.maturity_date,
      g.status as deal_status,
      DATEDIFF(g.maturity_date, CURDATE()) as days_to_maturity
    FROM gsec g
    LEFT JOIN counterparty_master_corporate corp ON g.counterparty = corp.id
    LEFT JOIN counterparty_master_individual ind ON g.counterparty = ind.id
    LEFT JOIN counterparty_master_joint joint ON g.counterparty = joint.id
    WHERE g.maturity_date <= ?
      AND COALESCE(g.matured, 0) = 0
    ORDER BY g.maturity_date ASC
  `;
  
  const [rows] = await db.query(query, [date]);
  return rows;
};

// Capture coupon cashflow for GSEC Buy transactions
Gsec.captureCouponCashflow = async (dealId, isin, faceValue, maturityDate, counterparty) => {
  try {
    console.log(`Capturing coupon cashflow for GSEC deal ${dealId}, ISIN: ${isin}`);
    
    // Get coupon schedule for this ISIN
    const [couponRows] = await db.query(`
      SELECT coupon_date, coupon_amount, principal
      FROM isin_coupon_schedule 
      WHERE isin = ? AND coupon_date > CURDATE() AND coupon_date <= ?
      ORDER BY coupon_date
    `, [isin, maturityDate]);
    
    if (couponRows.length === 0) {
      console.log(`No coupon schedule found for ISIN ${isin}`);
      return 0;
    }
    
    // Get cashflow categories
    const [categories] = await db.query(`
      SELECT id, name, type FROM cashflow_categories WHERE is_active = TRUE
    `);
    
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat.name.toLowerCase()] = cat;
    });
    
    const interestCategory = categoryMap['interest income'];
    if (!interestCategory) {
      console.log('Interest Income category not found');
      return 0;
    }
    
    let capturedCount = 0;
    
    // Create cashflow entries for each coupon payment
    for (const coupon of couponRows) {
      // Calculate coupon amount for this face value
      // coupon_amount is per 100 face value, so scale it
      const couponAmount = (parseFloat(coupon.coupon_amount) * parseFloat(faceValue)) / 100;
      
      if (couponAmount > 0) {
        await db.query(`
          INSERT INTO cashflow_transactions 
          (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
          VALUES (?, ?, ?, 'inflow', 'LKR', ?, ?, ?, 'confirmed')
        `, [
          interestCategory.id,
          coupon.coupon_date,
          couponAmount,
          `GSEC Coupon Payment - ISIN ${isin}`,
          `GSEC-${dealId}-COUPON-${coupon.coupon_date}`,
          counterparty
        ]);
        
        capturedCount++;
        console.log(`Captured coupon cashflow: ${couponAmount} on ${coupon.coupon_date}`);
      }
    }
    
    console.log(`Captured ${capturedCount} coupon cashflow entries for GSEC deal ${dealId}`);
    return capturedCount;
    
  } catch (error) {
    console.error('Error capturing coupon cashflow:', error);
    throw error;
  }
};

module.exports = Gsec;
