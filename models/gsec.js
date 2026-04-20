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

      // Parse counterparty string (e.g., 'i1', 'j1', 'c1') to extract the numeric ID
      let counterpartyId = null;
      if (data.counterparty) {
        const counterpartyStr = String(data.counterparty).trim();
        // Extract numeric part after the prefix (i, j, or c)
        if (counterpartyStr.match(/^[ijc]\d+$/)) {
          // Format: i1, j1, c1, etc.
          counterpartyId = parseInt(counterpartyStr.substring(1), 10);
        } else if (!isNaN(parseInt(counterpartyStr, 10))) {
          // Already a number
          counterpartyId = parseInt(counterpartyStr, 10);
        } else {
          // Try to extract any number from the string
          const match = counterpartyStr.match(/\d+/);
          if (match) {
            counterpartyId = parseInt(match[0], 10);
          }
        }
        
        if (isNaN(counterpartyId) || counterpartyId === null) {
          console.warn(`Warning: Could not parse counterparty ID from: ${data.counterparty}`);
          counterpartyId = null;
        }
      }

      // DB uses counterparty_id and isin_number (after rename from counterparty/isin)
      const counterpartyValue = data.counterparty != null && data.counterparty !== '' ? data.counterparty : counterpartyId;
      const sql = `INSERT INTO gsec (
        transaction_type, counterparty_id, deal_number, isin_number, face_value, trade_date, value_date, next_coupon_date, 
        last_coupon_date, number_of_days_interest_accrued, number_of_days_for_coupon_period, accrued_interest, 
        coupon_interest, clean_price, dirty_price, accrued_interest_calculation, accrued_interest_six_decimals, 
        accrued_interest_for_100, settlement_amount, settlement_mode, issue_date, maturity_date, coupon_dates, 
        yield, brokerage, currency, portfolio, strategy, broker, accrued_interest_adjustment, clean_price_adjustment, 
        buy_deal_number, status, current_approval_level, per_day_accrual
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      // Helper function to convert empty strings to null for numeric fields
      const cleanNumericValue = (value) => {
        if (value === '' || value === null || value === undefined) {
          return null;
        }
        // If it's already a number, return it
        if (typeof value === 'number') {
          return isNaN(value) ? null : value;
        }
        // If it's a string, try to parse it
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
            return null;
          }
          const parsed = parseFloat(trimmed);
          return isNaN(parsed) ? null : parsed;
        }
        return value;
      };

      const values = [
        data.transactionType,
        counterpartyValue, // counterparty: prefixed string ('c3') or numeric id for old schema
        data.dealNumber,
        data.isin,
        cleanNumericValue(data.faceValue),
        data.tradeDate || data.valueDate, // Use tradeDate if provided, otherwise fallback to valueDate
        data.valueDate,
        data.nextCouponDate,
        data.lastCouponDate,
        cleanNumericValue(data.numberOfDaysInterestAccrued),
        cleanNumericValue(data.numberOfDaysForCouponPeriod),
        cleanNumericValue(data.accruedInterest),
        cleanNumericValue(data.couponInterest),
        cleanNumericValue(data.cleanPrice),
        cleanNumericValue(data.dirtyPrice),
        data.accruedInterestCalculation,
        cleanNumericValue(data.accruedInterestSixDecimals),
        cleanNumericValue(data.accruedInterestFor100),
        cleanNumericValue(data.settlementAmount),
        data.settlementMode,
        data.issueDate,
        data.maturityDate,
        data.couponDates,
        cleanNumericValue(data.yield),
        cleanNumericValue(data.brokerage),
        data.currency || 'LKR',
        data.portfolio,
        data.strategy,
        data.broker,
        cleanNumericValue(data.accruedInterestAdjustment),
        cleanNumericValue(data.cleanPriceAdjustment),
        data.buyDealNumber || null,
        data.status || 'pending', // Status: pending by default
        data.current_approval_level || 'front_office', // 3-tier: start at front_office for Front Office Verifier
        cleanNumericValue(data.per_day_accrual) // Daily accrual amount
        // created_at has DEFAULT CURRENT_TIMESTAMP, so we don't need to include it
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
    // Query with JOIN to get counterparty short names.
    // DB uses isin_number and counterparty_id (after rename from isin/counterparty).
    const sql = `
      SELECT 
        g.*,
        g.isin_number AS isin,
        COALESCE(
          corp.short_name,
          ind.short_name,
          joint.short_name,
          CONCAT('ID:', g.counterparty_id)
        ) as counterparty_name
      FROM gsec g
      LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
      LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
      LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
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
          counterparty_name: transaction.counterparty_name || transaction.counterparty_id || 'Unknown'
        };
      });
      const rejectedRowsForDebug = formattedResults
        .filter(t => t.status === 'rejected')
        .slice(0, 20)
        .map(t => ({ id: t.id, deal_number: t.deal_number, created_by: t.created_by, status: t.status, current_approval_level: t.current_approval_level }));
      // #region agent log
      (typeof fetch === 'function') && fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'989560'},body:JSON.stringify({sessionId:'989560',runId:'pre-fix',hypothesisId:'H4',location:'gsec.js:getRecent',message:'Rejected rows returned to UI',data:{countRejected:rejectedRowsForDebug.length,rejectedRows:rejectedRowsForDebug},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      
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
      isin_number AS isin,
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
      sql += ' AND isin_number = ?';
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
    
    // Always calculate buyback deductions (approved sell/buy legs reduce available balance)
    const buybackDeductionsByDeal = {};
    if (dealNumbers.length) {
      // Detect whether sell_deal_allocations column exists so we can honour
      // the precise per-deal amounts stored at buyback creation time.
      let hasSellDealAllocationsColumn = false;
      try {
        const [allocCols] = await db.query(`
          SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'buyback_deals'
            AND COLUMN_NAME = 'sell_deal_allocations'
          LIMIT 1
        `);
        hasSellDealAllocationsColumn = Array.isArray(allocCols) && allocCols.length > 0;
      } catch (_) { /* leave false */ }

      const modalIsins = [...new Set(rows.map(r => (r.isin || '').trim()).filter(Boolean))];
      const placeholders = dealNumbers.map(() => '?').join(',');
      const isinPh = modalIsins.length ? modalIsins.map(() => '?').join(',') : "'__none__'";
      const effectiveCutoff = asAtDate || new Date().toISOString().split('T')[0];
      let buybackSql = `
        SELECT source_buy_deal_number, leg1_face_value, leg1_isin${hasSellDealAllocationsColumn ? ', sell_deal_allocations' : ''}
        FROM buyback_deals
        WHERE leg1_transaction_type = 'Sell'
        AND deal_status = 'Approved'
        AND DATE(COALESCE(approved_at, updated_at, created_at)) <= DATE(?)
        AND (source_buy_deal_number IN (${placeholders}) OR (source_buy_deal_number IS NULL AND leg1_isin IN (${isinPh})))
        ORDER BY COALESCE(approved_at, updated_at, created_at) ASC
      `;
      const buybackParams = [effectiveCutoff, ...dealNumbers, ...modalIsins];
      
      const [buybackRows] = await db.query(buybackSql, buybackParams);

      // Build ISIN → deal list for FIFO allocation of NULL-source buybacks
      const modalBuysByIsin = {};
      rows.forEach(r => {
        const dn = (r.deal_number || '').trim();
        const dealIsin = (r.isin || '').trim();
        if (!dn || !dealIsin) return;
        if (!modalBuysByIsin[dealIsin]) modalBuysByIsin[dealIsin] = [];
        modalBuysByIsin[dealIsin].push({ deal_number: dn, face_value: Number(r.face_value) || 0 });
      });

      const allocModalFIFO = (isin, amount, skipDeal) => {
        const candidates = modalBuysByIsin[isin];
        if (!candidates) return amount;
        let remaining = amount;
        for (const c of candidates) {
          if (remaining <= 0) break;
          if (skipDeal && c.deal_number === skipDeal) continue;
          const alreadyDeducted = Number(buybackDeductionsByDeal[c.deal_number] || 0);
          const sold = Number(soldByDeal[c.deal_number] || 0);
          const available = Math.max(0, c.face_value - sold - alreadyDeducted);
          if (available <= 0) continue;
          const alloc = Math.min(remaining, available);
          buybackDeductionsByDeal[c.deal_number] = alreadyDeducted + alloc;
          remaining -= alloc;
        }
        return remaining;
      };

      // Two-pass processing (mirrors services/gsecReportService.js):
      // Pass 1 uses precise per-deal amounts from sell_deal_allocations.
      // Pass 2 uses source_buy_deal_number + FIFO fallback for rows without allocations.
      const parseBBAllocs = (r) => {
        if (!r.sell_deal_allocations) return null;
        try {
          const a = typeof r.sell_deal_allocations === 'string'
            ? JSON.parse(r.sell_deal_allocations)
            : r.sell_deal_allocations;
          return Array.isArray(a) && a.length > 0 ? a : null;
        } catch (_) { return null; }
      };

      const bbWithAllocs = [];
      const bbWithoutAllocs = [];
      for (const row of buybackRows) {
        (parseBBAllocs(row) ? bbWithAllocs : bbWithoutAllocs).push(row);
      }

      for (const row of bbWithAllocs) {
        parseBBAllocs(row).forEach(a => {
          const dealNo = (a.deal_number || '').trim();
          const alloc = Number(a.amountToSell) || 0;
          if (dealNo && alloc > 0) {
            buybackDeductionsByDeal[dealNo] = (Number(buybackDeductionsByDeal[dealNo] || 0)) + alloc;
          }
        });
      }

      bbWithoutAllocs.forEach(row => {
        const key = (row.source_buy_deal_number || '').trim();
        const amount = Number(row.leg1_face_value) || 0;
        if (key) {
          const alreadyDeducted = Number(buybackDeductionsByDeal[key] || 0);
          const srcInfo = modalBuysByIsin[row.leg1_isin]?.find(c => c.deal_number === key);
          const srcFV = srcInfo ? srcInfo.face_value : 0;
          const sold = Number(soldByDeal[key] || 0);
          const capacity = Math.max(0, srcFV - sold - alreadyDeducted);
          const directAlloc = Math.min(amount, capacity);
          if (directAlloc > 0) buybackDeductionsByDeal[key] = alreadyDeducted + directAlloc;
          const overflow = amount - directAlloc;
          if (overflow > 0 && row.leg1_isin) {
            allocModalFIFO(row.leg1_isin, overflow, key);
          }
        } else if (row.leg1_isin) {
          allocModalFIFO(row.leg1_isin, amount, null);
        }
      });
    }
    
    return rows.map(deal => {
      const originalFace = Number(deal.face_value) || 0;
      const soldAmount = Number(soldByDeal[deal.deal_number] || 0);
      const buybackDeduction = Number(buybackDeductionsByDeal[deal.deal_number] || 0);

      // Always compute dynamically: original - gsec sells - buyback sells
      // This is the most reliable method as it doesn't depend on remaining_face_value being kept in sync.
      const remainingFace = Math.max(0, originalFace - soldAmount - buybackDeduction);
      
      return {
        ...deal,
        face_value: originalFace.toFixed(2),
        remaining_face_value: remainingFace.toFixed(4)
      };
    }).filter(deal => Number(deal.remaining_face_value) > 0);
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
    const [beforeRows] = await db.query('SELECT id, deal_number, transaction_type, status, current_approval_level, face_value, settlement_amount, clean_price, dirty_price, value_date, maturity_date FROM gsec WHERE id = ?', [id]);
    // #region agent log
    (typeof fetch === 'function') && fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'989560'},body:JSON.stringify({sessionId:'989560',runId:'pre-fix',hypothesisId:'H2_H5',location:'gsec.js:update:entry',message:'gsec.update before state',data:{id,before:beforeRows?.[0]||null,inputDealNumber:data?.dealNumber||data?.deal_number,inputStatus:data?.status,inputTransactionType:data?.transactionType||data?.transaction_type},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
      'trade_type', 'transaction_type', 'counterparty_id', 'deal_number', 'buy_deal_number', 'isin_number', 'face_value',
      'value_date', 'trade_date', 'next_coupon_date', 'last_coupon_date', 'number_of_days_interest_accrued',
      'number_of_days_for_coupon_period', 'accrued_interest', 'daily_accrual', 'coupon_interest', 'clean_price',
      'dirty_price', 'per_day_accrual', 'accrued_interest_calculation', 'accrued_interest_six_decimals',
      'accrued_interest_for_100', 'settlement_amount', 'settlement_mode', 'issue_date',
      'maturity_date', 'coupon_dates', 'yield', 'portfolio', 'clean_price_adjustment',
      'accrued_interest_adjustment', 'broker', 'strategy', 'stratergy', 'status', 'created_by',
      'created_at', 'updated_by', 'updated_at',
      'current_approval_level', 'brokerage', 'currency',
      'remaining_face_value', 'matured', 'sell_back_amount'
    ];
    
    // Resolve actual columns from DB so updates are schema-aware
    const [dbColumns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'gsec'`
    );
    const existingColumns = new Set((dbColumns || []).map((c) => c.COLUMN_NAME));

    // Map data object to SQL SET clauses
    Object.keys(data).forEach(key => {
      // Skip the id field and any fields that are not DB columns
      if (key !== 'id' && key !== 'userId') {
        // Convert camelCase to snake_case for DB fields
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        
        // Only include fields that are valid and actually exist in current schema
        if (validColumns.includes(dbField) && existingColumns.has(dbField)) {
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
      const [afterRows] = await db.query('SELECT id, deal_number, transaction_type, status, current_approval_level, face_value, settlement_amount, clean_price, dirty_price, value_date, maturity_date FROM gsec WHERE id = ?', [id]);
      // #region agent log
      (typeof fetch === 'function') && fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'989560'},body:JSON.stringify({sessionId:'989560',runId:'pre-fix',hypothesisId:'H2_H5',location:'gsec.js:update:exit',message:'gsec.update after state',data:{id,affectedRows:result?.affectedRows,beforeDealNumber:beforeRows?.[0]?.deal_number||null,after:afterRows?.[0]||null,setClauseCount:setClauses.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
    
    const currentLevel = (currentTx[0] && currentTx[0].current_approval_level) || 'front_office';
    let newStatus = data.status;
    let newApprovalLevel;
    let finalApproval = false;
    
    if (data.status === 'approved') {
      // 3-tier: advance front_office -> back_office_verifier -> back_office_final -> final_approved
      if (currentLevel === 'front_office') {
        newApprovalLevel = 'back_office_verifier';
        newStatus = 'pending';
      } else if (currentLevel === 'back_office_verifier') {
        newApprovalLevel = 'back_office_final';
        newStatus = 'pending';
      } else if (currentLevel === 'back_office_final') {
        newApprovalLevel = 'final_approved';
        newStatus = 'final_approved';
        finalApproval = true;
      } else {
        newApprovalLevel = currentLevel;
        newStatus = newStatus === 'final_approved' ? 'final_approved' : 'pending';
      }
    } else if (data.status === 'rejected') {
      newStatus = 'rejected';
      newApprovalLevel = 'rejected';
    } else {
      newApprovalLevel = currentLevel;
    }
    
    const sql = `
      UPDATE gsec 
      SET 
        status = ?,
        current_approval_level = ?
      WHERE id = ?
    `;
    
    const values = [
      newStatus,
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
                // Buy: Compound entry with Treasury Bonds (net) and Accrued Interest
                const settlementAmount = Number(transaction.settlement_amount || transaction.face_value || 0);
                const accruedInterest = Number(transaction.accrued_interest || 0);
                const netAmount = settlementAmount - accruedInterest;
                
                // Get account codes using mapping service (with fallback to new chart of accounts codes)
                let treasuryBondsAccount, accruedInterestAccount;
                try {
                  treasuryBondsAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT);
                } catch (err) {
                  treasuryBondsAccount = '131-101-350-098-44'; // Fallback: Treasury Bonds - Trading A/c
                }
                
                try {
                  accruedInterestAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUED_INTEREST_PAID);
                } catch (err) {
                  accruedInterestAccount = '131-101-350-128-44'; // Fallback: Accrued Coupon Interest Paid at Purchase
                }
                
                // Try to get settlement account from settlement_mode, otherwise use default Seylan Bank
                let bankAccount = '131-101-410-164-44'; // Default: Seylan Bank A/C - 0860-13374197-001
                if (transaction.settlement_mode) {
                  try {
                    const [settlementAccount] = await db.query(
                      'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
                      [transaction.settlement_mode]
                    );
                    if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
                      bankAccount = settlementAccount[0].ledger_account_code;
                    }
                  } catch (settlementError) {
                    console.error('Error fetching settlement account:', settlementError);
                    // Use default bank account
                  }
                }
                
                // Create compound entry: Dr Treasury Bonds (net), Dr Accrued Interest, Cr Bank (full)
                const ledgerResult = await ledgerController.postCompoundLedgerEntry({
                  date: transaction.value_date ? new Date(transaction.value_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                  dr_accounts: [
                    {
                      account_code: treasuryBondsAccount,
                      amount: netAmount,
                      description: `GSec Purchase - Treasury Bonds - ${transaction.deal_number}`
                    },
                    {
                      account_code: accruedInterestAccount,
                      amount: accruedInterest,
                      description: `GSec Purchase - Accrued Interest - ${transaction.deal_number}`
                    }
                  ],
                  cr_account: bankAccount,
                  deal_id: transaction.deal_number,
                  description: `GSec Purchase - Final Approval - ${transaction.deal_number}`
                });
                
                if (!ledgerResult.success) {
                  console.error('Failed to post GSec compound ledger entry:', ledgerResult.error);
                } else {
                  console.log(`Successfully created compound ledger entries for GSEC Buy transaction ${transaction.deal_number}`);
                  console.log(`  Treasury Bonds (net): ${netAmount}, Accrued Interest: ${accruedInterest}, Total: ${settlementAmount}`);
                }
                
                // Skip the old single entry logic for Buy transactions
                return result;
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
  let finalApproval = false;
  
  // Single approval level - directly mark as final_approved
  const updateFields = ", status = 'final_approved', current_approval_level = 'final_approved'";
  finalApproval = true;
  
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
          // Buy: Compound entry with Treasury Bonds (net) and Accrued Interest
          const settlementAmount = Number(transaction.settlement_amount || transaction.face_value || 0);
          const accruedInterest = Number(transaction.accrued_interest || 0);
          const netAmount = settlementAmount - accruedInterest;
          
          // Get account codes using mapping service (with fallback to new chart of accounts codes)
          let treasuryBondsAccount, accruedInterestAccount;
          try {
            treasuryBondsAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT);
          } catch (err) {
            treasuryBondsAccount = '131-101-350-098-44'; // Fallback: Treasury Bonds - Trading A/c
          }
          
          try {
            accruedInterestAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUED_INTEREST_PAID);
          } catch (err) {
            accruedInterestAccount = '131-101-350-128-44'; // Fallback: Accrued Coupon Interest Paid at Purchase
          }
          
          // Try to get settlement account from settlement_mode, otherwise use default Seylan Bank
          let bankAccount = '131-101-410-164-44'; // Default: Seylan Bank A/C - 0860-13374197-001
          if (transaction.settlement_mode) {
            try {
              const [settlementAccount] = await db.query(
                'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
                [transaction.settlement_mode]
              );
              if (settlementAccount && settlementAccount.length > 0 && settlementAccount[0].ledger_account_code) {
                bankAccount = settlementAccount[0].ledger_account_code;
              }
            } catch (settlementError) {
              console.error('Error fetching settlement account:', settlementError);
              // Use default bank account
            }
          }
          
          // Create compound entry: Dr Treasury Bonds (net), Dr Accrued Interest, Cr Bank (full)
          const ledgerResult = await ledgerController.postCompoundLedgerEntry({
            date: transaction.value_date ? new Date(transaction.value_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            dr_accounts: [
              {
                account_code: treasuryBondsAccount,
                amount: netAmount,
                description: `GSec Purchase - Treasury Bonds - ${transaction.deal_number}`
              },
              {
                account_code: accruedInterestAccount,
                amount: accruedInterest,
                description: `GSec Purchase - Accrued Interest - ${transaction.deal_number}`
              }
            ],
            cr_account: bankAccount,
            deal_id: transaction.deal_number,
            description: `GSec Purchase - Final Approval - ${transaction.deal_number}`
          });
          
          if (!ledgerResult.success) {
            errors.push(`Transaction ${transaction.deal_number}: Failed to post compound ledger entry - ${ledgerResult.error}`);
          } else {
            processed++;
            console.log(`Backfilled compound ledger entries for GSEC Buy transaction ${transaction.deal_number}`);
            console.log(`  Treasury Bonds (net): ${netAmount}, Accrued Interest: ${accruedInterest}, Total: ${settlementAmount}`);
          }
          continue; // Skip the old single entry logic
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
      g.isin_number AS isin,
      g.counterparty_id AS counterparty,
      COALESCE(
        corp.short_name,
        ind.short_name,
        joint.short_name,
        g.counterparty_id
      ) as counterparty_name,
      g.face_value,
      g.settlement_amount,
      g.accrued_interest,
      g.maturity_date,
      g.status as deal_status,
      DATEDIFF(g.maturity_date, CURDATE()) as days_to_maturity
    FROM gsec g
    LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
    LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
    LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
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
