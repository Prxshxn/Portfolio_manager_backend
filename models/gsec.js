const db = require('../config/database');
const LimitSetup = require('./limitSetupModel');

const Gsec = {
  create: async (data) => {
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
          console.log('[DEBUG] valueDate:', data.valueDate);
          console.log('[DEBUG] dateStr for deal number:', dateStr);
          data.dealNumber = await Gsec.generateNextDealNumber(dateStr);
          console.log('[DEBUG] dealNumber after generation:', data.dealNumber);
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
      
      // Calculate dirty price as clean price + accrued interest
      if (data.cleanPrice && data.accruedInterest) {
        data.dirtyPrice = parseFloat(data.cleanPrice) + parseFloat(data.accruedInterest);
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
        trade_type, transaction_type, counterparty, deal_number, isin, face_value, value_date, next_coupon_date, 
        last_coupon_date, number_of_days_interest_accrued, number_of_days_for_coupon_period, accrued_interest, 
        coupon_interest, clean_price, dirty_price, accrued_interest_calculation, accrued_interest_six_decimals, 
        accrued_interest_for_100, settlement_amount, settlement_mode, issue_date, maturity_date, coupon_dates, 
        yield, brokerage, currency, portfolio, strategy, broker, accrued_interest_adjustment, clean_price_adjustment, 
        per_day_accrual, status, created_by, created_at, current_approval_level, custodian
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      const values = [
        data.tradeType,
        data.transactionType,
        data.counterparty,
        data.dealNumber,
        data.isin,
        data.faceValue,
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
        'pending', // Default status for authorization workflow
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
        // First check if this would exceed the counterparty limit
        if (data.counterparty) {
          try {
            // We need to implement a promise-based version of checkGsecLimit
            const limitCheck = await Gsec.checkGsecLimitAsync(data);
            if (!limitCheck.allowed) {
              const error = {
                status: 400,
                message: 'GSec limit exceeded',
                details: limitCheck.message,
                limitDetails: limitCheck
              };
              throw error;
            }
          } catch (limitErr) {
            throw limitErr;
          }
        }
        // If limit check passes or no counterparty, proceed with the insert
        const [result] = await db.query(sql, values);
        return result;
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
              console.warn(`[RETRY] Duplicate deal_number, retrying with new dealNumber: ${data.dealNumber}`);
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
  checkGsecLimitAsync: async (data) => {
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
      
      // Check if it's an individual counterparty
      const [individualRows] = await db.query(
        'SELECT id, "individual" as type FROM counterparty_master_individual WHERE id = ?',
        [originalId]
      );
      
      if (individualRows && individualRows.length > 0) {
        counterpartyType = 'individual';
        console.log(`Found counterparty as individual: ${originalId}`);
        return await Gsec.checkLimitsAsync(originalId, counterpartyType, amount, currency);
      } else {
        // Check if it's a joint counterparty
        const [jointRows] = await db.query(
          'SELECT id, "joint" as type FROM counterparty_master_joint WHERE id = ?',
          [originalId]
        );
        
        if (jointRows && jointRows.length > 0) {
          counterpartyType = 'joint';
          console.log(`Found counterparty as joint: ${originalId}`);
          return await Gsec.checkLimitsAsync(originalId, counterpartyType, amount, currency);
        } else {
          // Check if it's a corporate counterparty
          const [corporateRows] = await db.query(
            'SELECT id, "corporate" as type FROM counterparty_master_corporate WHERE id = ?',
            [originalId]
          );
          
          if (corporateRows && corporateRows.length > 0) {
            counterpartyType = 'corporate';
            console.log(`Found counterparty as corporate: ${originalId}`);
            return await Gsec.checkLimitsAsync(originalId, counterpartyType, amount, currency);
          } else {
            // Log detailed error information
            console.error(`Counterparty ID ${counterpartyId} (original: ${originalId}) not found in any counterparty table`);
            
            // Check what counterparties exist for debugging
            const [allIndividual] = await db.query('SELECT id, short_name FROM counterparty_master_individual LIMIT 5');
            const [allJoint] = await db.query('SELECT id, short_name FROM counterparty_master_joint LIMIT 5');
            const [allCorporate] = await db.query('SELECT id, short_name FROM counterparty_master_corporate LIMIT 5');
            
            console.log('Available counterparties (first 5 of each type):');
            console.log('Individual:', allIndividual);
            console.log('Joint:', allJoint);
            console.log('Corporate:', allCorporate);
            
            return {
              allowed: false,
              message: `Invalid counterparty ID: ${counterpartyId}. Please select a valid counterparty from the dropdown.`
            };
          }
        }
      }
    } catch (error) {
      console.error('Error in checkGsecLimitAsync:', error);
      throw error;
    }
  },
  
  // Promise-based helper function for checking limits
  checkLimitsAsync: async (counterpartyId, counterpartyType, amount, currency) => {
    try {
      // Get the current limit setup for this counterparty
      const [limitRows] = await db.query(
        `SELECT * FROM counterparty_limits 
         WHERE counterparty_id = ? 
         AND counterparty_type = ?
         AND (currency = ? OR currency IS NULL OR currency = '')`,
        [counterpartyId, counterpartyType, currency]
      );
      
      if (!limitRows || limitRows.length === 0) {
        // Allow transaction if no limits are configured
        return {
          allowed: true,
          message: 'No limits configured for this counterparty and currency, allowing transaction.'
        };
      }
      
      const limits = limitRows[0];
      
      // Get current GSec exposure for this counterparty
      const [gsecRows] = await db.query(
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
    // Use a simple query first to debug the issue
    const sql = `SELECT * FROM gsec ORDER BY id DESC LIMIT 100`;
    
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
          // Add default counterparty name since we're not joining tables yet
          counterparty_name: 'Unknown'
        };
      });
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
  getBuyDealsWithBalanceFiltered: async (isin, portfolio) => {
    // Build SQL with optional filters
    let sql = `SELECT * FROM gsec WHERE transaction_type = 'Buy' AND (remaining_face_value > 0 OR remaining_face_value IS NULL)`;
    const params = [];
    if (isin) {
      sql += ' AND isin = ?';
      params.push(isin);
    }
    if (portfolio) {
      sql += ' AND portfolio = ?';
      params.push(portfolio);
    }
    const [rows] = await db.query(sql, params);
    return rows;
  },

  /**
   * Get all Buy deals with remaining face value (original - total sold from this deal)
   * Only for display, does not update Buy record. Uses buy_deal_number in Sell transactions.
   */
  getBuyDealsWithBalance: async () => {
    // Get all Buy deals
    const buySql = `SELECT * FROM gsec WHERE transaction_type = 'Buy' ORDER BY id DESC`;
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
    const sql = `SELECT * FROM gsec WHERE transaction_type = 'Buy' ORDER BY id DESC`;
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
    
    // Map data object to SQL SET clauses
    Object.keys(data).forEach(key => {
      // Skip the id field and any fields that are not DB columns
      if (key !== 'id' && key !== 'userId') {

        // Convert camelCase to snake_case for DB fields
        const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        setClauses.push(`${dbField} = ?`);
        values.push(data[key]);
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
    // Determine the new approval level based on current status and action
    let newApprovalLevel = data.current_approval_level || 1;
    let newStatus = data.status;
    
    if (data.status === 'approved') {
      // Advance to next approval level
      if (newApprovalLevel === 1) {
        newApprovalLevel = 2;
        newStatus = 'pending';
      } else if (newApprovalLevel === 2) {
      } else if (data.current_approval_level === 2) {
        newApprovalLevel = 3;
        newStatus = 'pending';
      } else if (data.current_approval_level === 3) {
        newApprovalLevel = 3; // Stay at final
        newStatus = 'approved';
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
  console.log('[DEBUG] getLatestDealNumber for', date, ':', latest);
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
      console.log('[DEBUG] Latest deal found:', latest);
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
    console.log('[DEBUG] Generated next deal number:', nextDeal);
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
      await ledgerController.postLedgerEntry({
        date: new Date().toISOString().slice(0, 10),
        dr_account: '1-034-01-01-01', // Asset TBonds
        cr_account: '1-666-01-01-01', // Asset Seylan Bank 123 A/C
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
  const sql = "SELECT * FROM gsec WHERE portfolio = ? AND transaction_type = 'Buy'";
  const [rows] = await db.query(sql, [portfolioId]);
  return rows;
};

// Get maturities by date (without deal status filtering as requested)
Gsec.getMaturitiesByDate = async (date) => {
  const query = `
    SELECT 
      g.isin,
      g.counterparty,
      COALESCE(
        corp.short_name,
        ind.short_name,
        joint.short_name,
        g.counterparty
      ) as counterparty_name,
      g.face_value,
      g.maturity_date,
      g.status as deal_status,
      DATEDIFF(g.maturity_date, CURDATE()) as days_to_maturity
    FROM gsec g
    LEFT JOIN counterparty_master_corporate corp ON g.counterparty = corp.id
    LEFT JOIN counterparty_master_individual ind ON g.counterparty = ind.id
    LEFT JOIN counterparty_master_joint joint ON g.counterparty = joint.id
    WHERE g.maturity_date <= ?
    ORDER BY g.maturity_date ASC
  `;
  
  const [rows] = await db.query(query, [date]);
  return rows;
};

module.exports = Gsec;
