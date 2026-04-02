const db = require('../config/db');
const { differenceInDays, parseISO } = require('date-fns');
const { calculateNVP } = require('../utils/bondPricingNVP');

// Helper to truncate to 4 decimals
function truncate4(val) {
  return Math.floor(Number(val) * 10000) / 10000;
}

// Number formatting functions for better display
function formatCurrency(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPrice(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercentage(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

exports.getGsecReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, page, pageSize }) => {
  try {
    // Debug: Log the asAtDate parameter
    console.log(`[GSEC Report] Called with asAtDate: ${asAtDate}, portfolio: ${portfolio}, isin: ${isin}`);
    
    // Build query with filters - only include Buy transactions from GSEC deals
    // Note: remaining_face_value is computed, not a column, so we calculate it later
    let sql = `SELECT g.id, g.portfolio, g.deal_number, g.face_value, g.value_date, g.maturity_date, g.isin_number as isin, g.coupon_interest, g.clean_price, g.yield, g.counterparty_id, g.transaction_type, 
               COALESCE(
                 corp.short_name,
                 ind.short_name,
                 joint.short_name,
                 CONCAT('ID:', g.counterparty_id)
               ) AS counterparty_name,
               im.coupon_rate, im.issue_date, im.coupon_date_1, im.coupon_date_2
      FROM gsec g 
      LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
      LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
      LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
      LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
      WHERE g.transaction_type = 'Buy'`;
    const params = [];
    
    // Add GSEC filters
    if (portfolio) {
      sql += ' AND g.portfolio = ?';
      params.push(portfolio);
    }
    if (isin) {
      sql += ' AND g.isin_number = ?';
      params.push(isin);
    }
    if (valueDate) {
      sql += ' AND g.value_date = ?';
      params.push(valueDate);
    }
    if (maturityDate) {
      sql += ' AND g.maturity_date = ?';
      params.push(maturityDate);
    }
    if (asAtDate) {
      sql += ' AND g.value_date <= ?';
      params.push(asAtDate);
    }
    
    // Add ordering
    sql += ` ORDER BY g.isin_number, g.maturity_date, g.id`;

    // Pagination - only apply if page and pageSize are provided
    if (page && pageSize) {
      const pageSizeNum = parseInt(pageSize, 10);
      const pageNum = parseInt(page, 10);
      const offset = (pageNum - 1) * pageSizeNum;
      sql += ' LIMIT ? OFFSET ?';
      params.push(pageSizeNum, offset);
    }

    console.log(`[GSEC Report] SQL Query: ${sql}`);
    console.log(`[GSEC Report] Params:`, params);

    // Query DB
    let rows;
    try {
      [rows] = await db.query(sql, params);
      console.log(`[GSEC Report] Query returned ${rows.length} rows`);
    } catch (queryError) {
      console.error('[GSEC Report] Database query error:', queryError);
      console.error('[GSEC Report] SQL:', sql);
      console.error('[GSEC Report] Params:', params);
      throw new Error(`Database query failed: ${queryError.message}`);
    }

  // Build a map of total sold per buy deal_number to compute remaining face value per row
  const dealNumbers = rows.map(r => (r.deal_number || '').trim()).filter(Boolean);
  const soldByDeal = {};
  if (dealNumbers.length) {
    // Grouped query to sum sells referencing these buy deals
    // Include asAtDate filter for backdating support
    const placeholders = dealNumbers.map(() => '?').join(',');
    let sellRefSql = `
      SELECT TRIM(buy_deal_number) AS buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
      FROM gsec
      WHERE transaction_type = 'Sell' 
      AND buy_deal_number IS NOT NULL 
      AND TRIM(buy_deal_number) IN (${placeholders})
    `;
    const sellRefParams = [...dealNumbers];
    
    // Add asAtDate filter for backdating - only include sell transactions on or before asAtDate
    // CRITICAL: Only count sells that occurred on or BEFORE the asAtDate based on value_date
    // This ensures future-dated sells (like 10/30) don't affect reports for earlier dates (like 10/27)
    if (asAtDate) {
      console.log(`[GSEC Report] Filtering sell transactions for asAtDate: ${asAtDate}`);
      console.log(`[GSEC Report] Will exclude sells with value_date > ${asAtDate}`);
      // Filter by value_date - DATE comparison to exclude future-dated sells
      sellRefSql += ' AND DATE(value_date) <= DATE(?)';
      sellRefParams.push(asAtDate);
    } else {
      // For current date reports, count all sells regardless of status
      // (they'll be shown in the table and counted in balance)
      sellRefSql += '';
    }
    
    sellRefSql += ' GROUP BY TRIM(buy_deal_number)';
    
    console.log(`[DEBUG] Sell query: ${sellRefSql}`);
    console.log(`[DEBUG] Sell query params:`, sellRefParams);
    
    const [sellRefRows] = await db.query(sellRefSql, sellRefParams);
    console.log(`[DEBUG] Sell query returned ${sellRefRows.length} rows:`, sellRefRows);
    sellRefRows.forEach(r => {
      const trimmedKey = (r.buy_deal_number || '').trim();
      soldByDeal[trimmedKey] = Number(r.total_sold) || 0;
      console.log(`[DEBUG] soldByDeal["${trimmedKey}"] = ${soldByDeal[trimmedKey]}`);
    });
  }

  // Calculate repo_collateral for each deal and derive remaining face value for display
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Calculate repo_collateral for this ISIN
    // New: support multi-ISIN allocations via repo_deal_isins, while remaining backward compatible
    const [repoChildRows] = await db.query(`
      SELECT COALESCE(SUM(rdi.face_value), 0) AS repo_collateral
      FROM repo_deal_isins rdi
      JOIN repo_deals rd ON rd.id = rdi.repo_deal_id
      WHERE rdi.isin_number = ? AND rd.status IN ('Active', 'Pending')
    `, [row.isin]);

    // Legacy fallback: deals that still store a single ISIN directly on repo_deals and have no child rows
    const [repoLegacyRows] = await db.query(`
      SELECT COALESCE(SUM(rd.face_value), 0) AS repo_collateral
      FROM repo_deals rd
      LEFT JOIN repo_deal_isins rdi ON rdi.repo_deal_id = rd.id
      WHERE rdi.id IS NULL AND rd.isin_number = ? AND rd.status IN ('Active', 'Pending')
    `, [row.isin]);

    row.repo_collateral = Number(repoChildRows?.[0]?.repo_collateral || 0) + Number(repoLegacyRows?.[0]?.repo_collateral || 0);
    
    // Use the remaining_face_value from database (which includes buyback deductions)
    // Only fall back to dynamic calculation if remaining_face_value is null/undefined
    // Normalize deal_number by trimming for lookup
    const normalizedDealNumber = (row.deal_number || '').trim();
    const soldAgainstThisDeal = Number(soldByDeal[normalizedDealNumber] || 0);
    const originalFace = Number(row.face_value) || 0;
    // remaining_face_value is computed, not a column, so always use 0
    const dbRemainingFaceValue = 0;
    
    console.log(`Deal ${row.deal_number}: originalFace=${originalFace}, dbRemainingFaceValue=${dbRemainingFaceValue}, soldAgainstThisDeal=${soldAgainstThisDeal}`);
    
    // Calculate buyback deductions with backdating support
    let buybackDeduction = 0;
    if (asAtDate) {
      // Check if leg1_portfolio column exists in buyback_deals table
      let hasPortfolioColumn = false;
      try {
        const [schemaCheck] = await db.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'buyback_deals' 
          AND COLUMN_NAME = 'leg1_portfolio'
        `);
        hasPortfolioColumn = schemaCheck.length > 0;
      } catch (schemaError) {
        console.warn('[GSEC Report] Could not check schema, assuming leg1_portfolio does not exist');
      }
      
      // Build query conditionally based on whether portfolio column exists
      let buybackSql = `
        SELECT leg1_face_value, source_buy_deal_number
        FROM buyback_deals 
        WHERE leg1_isin = ?`;
      const buybackParams = [row.isin];
      
      if (hasPortfolioColumn && row.portfolio) {
        buybackSql += ' AND leg1_portfolio = ?';
        buybackParams.push(row.portfolio);
      }
      
      // Check if leg1_transaction_type column exists
      let hasTransactionTypeColumn = false;
      try {
        const [txTypeCheck] = await db.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'buyback_deals' 
          AND COLUMN_NAME = 'leg1_transaction_type'
        `);
        hasTransactionTypeColumn = txTypeCheck.length > 0;
      } catch (schemaError) {
        console.warn('[GSEC Report] Could not check leg1_transaction_type schema');
      }
      
      if (hasTransactionTypeColumn) {
        buybackSql += ` AND leg1_transaction_type = 'Sell'`;
      }
      
      buybackSql += ` AND deal_status = 'Approved'
        AND DATE(approved_at) <= ?
        AND (source_buy_deal_number = ? OR source_buy_deal_number IS NULL)`;
      buybackParams.push(asAtDate, row.deal_number);
      
      const [buybackRows] = await db.query(buybackSql, buybackParams);
      
      buybackRows.forEach(buybackRow => {
        // If source_buy_deal_number matches this deal, or if it's null (chronological deduction)
        if (buybackRow.source_buy_deal_number === row.deal_number || !buybackRow.source_buy_deal_number) {
          buybackDeduction += Number(buybackRow.leg1_face_value) || 0;
        }
      });
      
      console.log(`Deal ${row.deal_number}: buybackDeduction=${buybackDeduction} for asAtDate=${asAtDate}`);
    } else {
      // For no asAtDate, calculate buyback deductions dynamically to ensure accuracy
      // Check if leg1_portfolio column exists
      let hasPortfolioColumn = false;
      try {
        const [schemaCheck] = await db.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'buyback_deals' 
          AND COLUMN_NAME = 'leg1_portfolio'
        `);
        hasPortfolioColumn = schemaCheck.length > 0;
      } catch (schemaError) {
        console.warn('[GSEC Report] Could not check schema, assuming leg1_portfolio does not exist');
      }
      
      // Build query conditionally
      let buybackSql = `
        SELECT leg1_face_value, source_buy_deal_number
        FROM buyback_deals 
        WHERE leg1_isin = ?`;
      const buybackParams = [row.isin];
      
      if (hasPortfolioColumn && row.portfolio) {
        buybackSql += ' AND leg1_portfolio = ?';
        buybackParams.push(row.portfolio);
      }
      
      // Check if leg1_transaction_type column exists
      let hasTransactionTypeColumn = false;
      try {
        const [txTypeCheck] = await db.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'buyback_deals' 
          AND COLUMN_NAME = 'leg1_transaction_type'
        `);
        hasTransactionTypeColumn = txTypeCheck.length > 0;
      } catch (schemaError) {
        console.warn('[GSEC Report] Could not check leg1_transaction_type schema');
      }
      
      if (hasTransactionTypeColumn) {
        buybackSql += ` AND leg1_transaction_type = 'Sell'`;
      }
      
      buybackSql += ` AND deal_status = 'Approved'
        AND (source_buy_deal_number = ? OR source_buy_deal_number IS NULL)`;
      buybackParams.push(row.deal_number);
      
      const [buybackRows] = await db.query(buybackSql, buybackParams);
      
      buybackRows.forEach(buybackRow => {
        // If source_buy_deal_number matches this deal, or if it's null (chronological deduction)
        if (buybackRow.source_buy_deal_number === row.deal_number || !buybackRow.source_buy_deal_number) {
          buybackDeduction += Number(buybackRow.leg1_face_value) || 0;
        }
      });
      
      console.log(`Deal ${row.deal_number}: buybackDeduction=${buybackDeduction} (no asAtDate, calculated dynamically)`);
    }

    // Calculate final remaining face value
    const today = new Date().toISOString().split('T')[0];
    const isCurrentDate = asAtDate === today;
    
    console.log(`[DEBUG] Deal ${row.deal_number}: asAtDate=${asAtDate}, today=${today}, isCurrentDate=${isCurrentDate}`);
    
    if (asAtDate) {
      // ALWAYS calculate dynamically for historical dates
      // The database remaining_face_value might include future transactions
      // We need to recalculate based on the asAtDate
      row.remaining_face_value_report = Math.max(0, originalFace - soldAgainstThisDeal - buybackDeduction);
      console.log(`[DEBUG] Calculated for asAtDate ${asAtDate}: ${originalFace} - ${soldAgainstThisDeal} - ${buybackDeduction} = ${row.remaining_face_value_report}`);
    } else {
      // For no asAtDate, calculate dynamically to ensure sell and buyback deductions are included
      // Use database value as fallback only if it's more accurate (but still calculate to be safe)
      const calculatedRemaining = Math.max(0, originalFace - soldAgainstThisDeal - buybackDeduction);
      // Prefer calculated value, but use database value if it's valid and close (within tolerance)
      row.remaining_face_value_report = calculatedRemaining;
      console.log(`[DEBUG] No asAtDate: calculated=${calculatedRemaining}, dbRemainingFaceValue=${dbRemainingFaceValue}, using calculated`);
    }
    
    console.log(`Deal ${row.deal_number}: final remaining_face_value_report=${row.remaining_face_value_report}`);

    // No sell_back calculation - sell transactions are handled in separate report
    row.sell_back = 0;
  }

  // Get all unique ISINs from the current page results
  const uniqueIsins = [...new Set(rows.map(row => row.isin))];

  // Calculate balance for each ISIN across ALL records (not just current page)
  const isinBalances = {};
  const isinWapMap = {};
  
  for (const isin of uniqueIsins) {
      // Query all Buy records for this ISIN to calculate correct balance
      let balanceSql = `SELECT face_value, clean_price FROM gsec WHERE isin_number = ? AND transaction_type = 'Buy'`;
    const balanceParams = [isin];
    
    // Apply the same filters as the main query for GSEC deals
    if (portfolio) {
      balanceSql += ' AND portfolio = ?';
      balanceParams.push(portfolio);
    }
    if (valueDate) {
      balanceSql += ' AND value_date = ?';
      balanceParams.push(valueDate);
    }
    if (maturityDate) {
      balanceSql += ' AND maturity_date = ?';
      balanceParams.push(maturityDate);
    }
    if (asAtDate) {
      balanceSql += ' AND value_date <= ?';
      balanceParams.push(asAtDate);
    }
    
    const [balanceRows] = await db.query(balanceSql, balanceParams);
    
      // Calculate balance for this ISIN (start with Buy totals)
    isinBalances[isin] = 0;
    isinWapMap[isin] = { sumFV: 0, sumFVCP: 0 };
    
    balanceRows.forEach(balanceRow => {
        // Only Buy transactions contribute to initial balance
        isinBalances[isin] += Number(balanceRow.face_value);

        // Aggregate for WAP calculation
        const fv = Number(balanceRow.face_value) || 0;
        const cp = Number(balanceRow.clean_price) || 0;
        isinWapMap[isin].sumFV += fv;
        isinWapMap[isin].sumFVCP += fv * cp;
      });

      // Subtract normal Sell transactions for this ISIN from balance
      let sellSql = `SELECT COALESCE(SUM(face_value), 0) AS sold FROM gsec WHERE isin_number = ? AND transaction_type = 'Sell'`;
      const sellParams = [isin];
      if (portfolio) {
        sellSql += ' AND portfolio = ?';
        sellParams.push(portfolio);
      }
      if (valueDate) {
        sellSql += ' AND value_date = ?';
        sellParams.push(valueDate);
      }
      if (maturityDate) {
        sellSql += ' AND maturity_date = ?';
        sellParams.push(maturityDate);
      }
      if (asAtDate) {
        console.log(`[GSEC Report] Filtering ISIN balance sells for asAtDate: ${asAtDate}`);
        sellSql += ' AND DATE(value_date) <= DATE(?)';
        sellParams.push(asAtDate);
      }
      
      // Don't filter by status in ISIN balance calculation - count all sells
      // The date filter (DATE(value_date) <= DATE(asAtDate)) is what matters

      const [sellAggRows] = await db.query(sellSql, sellParams);
      const totalSoldForIsin = Number(sellAggRows?.[0]?.sold || 0);
      isinBalances[isin] = Math.max(0, Number(isinBalances[isin]) - totalSoldForIsin);

      // Subtract buyback deductions for this ISIN with backdating support
      if (asAtDate) {
        // Check if leg1_portfolio column exists
        let hasPortfolioColumn = false;
        try {
          const [schemaCheck] = await db.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'buyback_deals' 
            AND COLUMN_NAME = 'leg1_portfolio'
          `);
          hasPortfolioColumn = schemaCheck.length > 0;
        } catch (schemaError) {
          console.warn('[GSEC Report] Could not check schema for ISIN balance, assuming leg1_portfolio does not exist');
        }
        
        // Check if leg1_transaction_type column exists
        let hasTransactionTypeColumn = false;
        try {
          const [txTypeCheck] = await db.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'buyback_deals' 
            AND COLUMN_NAME = 'leg1_transaction_type'
          `);
          hasTransactionTypeColumn = txTypeCheck.length > 0;
        } catch (schemaError) {
          console.warn('[GSEC Report] Could not check leg1_transaction_type schema for ISIN balance');
        }
        
        let buybackSql = `
          SELECT COALESCE(SUM(leg1_face_value), 0) AS buyback_deduction
          FROM buyback_deals 
          WHERE leg1_isin = ?`;
        const buybackParams = [isin];
        
        if (hasTransactionTypeColumn) {
          buybackSql += ` AND leg1_transaction_type = 'Sell'`;
        }
        
        buybackSql += ` AND deal_status = 'Approved' AND approved_at <= ?`;
        buybackParams.push(asAtDate);
        
        if (hasPortfolioColumn && portfolio) {
          buybackSql += ' AND leg1_portfolio = ?';
          buybackParams.push(portfolio);
        }
        
        const [buybackRows] = await db.query(buybackSql, buybackParams);
        const totalBuybackDeduction = Number(buybackRows?.[0]?.buyback_deduction || 0);
        isinBalances[isin] = Math.max(0, Number(isinBalances[isin]) - totalBuybackDeduction);
      }
      // For current date, buyback deductions are already included in the database remaining_face_value
  }

  // Helper to safely parse ISO date strings
  function safeParseISO(val) {
    if (!val) return null;
    if (typeof val === 'string') return parseISO(val);
    if (val instanceof Date) return val;
    return null;
  }

  // Use asAtDate for NVP calculation if provided, otherwise use current system date
  // This ensures NVP is calculated to the asAtDate (historical date) when viewing past reports
  const valueDateForNVP = asAtDate || new Date().toISOString().split('T')[0];

  // Format results
  const data = rows.map(row => {
    const maturityDateObj = safeParseISO(row.maturity_date);
    const asAtDateObj = safeParseISO(asAtDate);
    let dtm = '';
    if (maturityDateObj && asAtDateObj) {
      dtm = differenceInDays(maturityDateObj, asAtDateObj);
    }

    // Calculate NVP using asAtDate as value date (same calculation as fixed income entry form)
    // This matches the clean price calculation logic from the frontend
    const nvpResult = calculateNVP({
      faceValue: row.face_value,
      couponRate: row.coupon_rate,
      yieldRate: row.yield,
      systemDate: valueDateForNVP, // Use asAtDate if provided, otherwise current date
      maturityDate: row.maturity_date,
      issueDate: row.issue_date,
      couponDate1: row.coupon_date_1,
      couponDate2: row.coupon_date_2
    });

    // Calculate available balance: deal face value - repo_collateral (deal-wise calculation)
    const dealFaceValue = Number(row.remaining_face_value_report ?? row.face_value) || 0;
    const repoCollateral = Number(row.repo_collateral) || 0;
    const availableBalance = dealFaceValue - repoCollateral;
    
    console.log(`Deal ${row.deal_number}: dealFaceValue=${dealFaceValue}, repoCollateral=${repoCollateral}, availableBalance=${availableBalance}`);

    return {
      id: row.id,
      product_type: 'GSec',
      portfolio: row.portfolio,
      custodian: '', // custodian column doesn't exist in gsec table
      deal_number: row.deal_number || '',
      // Show remaining face value (after deducting sell deals and buyback deals) in the Face Value column
      // This reflects the actual available face value at the point of creation
      face_value: formatCurrency(row.remaining_face_value_report ?? row.face_value, 2),
      value_date: row.value_date,
      maturity_date: row.maturity_date,
      isin: row.isin,
      coupon_interest: formatPrice(row.coupon_interest, 4),
      clean_price: formatPrice(row.clean_price, 4),
      yield: formatPercentage(row.yield, 4),
      dtm: dtm ? dtm.toLocaleString('en-US') : '',
      balance: formatPrice(isinBalances[row.isin], 4),
      available_balance: formatPrice(availableBalance, 4),
      wap: (function() {
        const wapData = isinWapMap[row.isin];
        if (wapData && wapData.sumFV) {
          const wapValue = Math.floor((wapData.sumFVCP / wapData.sumFV) * 10000) / 10000;
          return formatPrice(wapValue, 4);
        }
        return '';
      })(),
      nvp: nvpResult.nvp ? formatPrice(nvpResult.nvp, 4) : '',
      accrued_interest: nvpResult.accruedInterest ? formatPrice(nvpResult.accruedInterest, 4) : '',
      repo_collateral: row.repo_collateral ? formatPrice(row.repo_collateral, 4) : '0.0000',
      sell_back: row.sell_back ? formatCurrency(row.sell_back, 2) : '0.00',
      counterparty: row.counterparty_name || (row.counterparty_id ? String(row.counterparty_id) : ''),
      transaction_type: row.transaction_type || ''
    };
  });

  // Get total count for pagination - only count Buy transactions
  let countParams = [];
  if (portfolio) countParams.push(portfolio);
  if (isin) countParams.push(isin);
  if (valueDate) countParams.push(valueDate);
  if (maturityDate) countParams.push(maturityDate);
  if (asAtDate) countParams.push(asAtDate);
  
  // Count query - only Buy transactions from GSEC
  let countSql = `SELECT COUNT(*) as count FROM gsec g 
    LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
    WHERE g.transaction_type = 'Buy'` +
    (portfolio ? ' AND g.portfolio = ?' : '') +
    (isin ? ' AND g.isin_number = ?' : '') +
    (valueDate ? ' AND g.value_date = ?' : '') +
    (maturityDate ? ' AND g.maturity_date = ?' : '') +
    (asAtDate ? ' AND g.value_date <= ?' : '');
  
  const [[{ count }]] = await db.query(countSql, countParams);

  // Calculate total portfolio balance when portfolio filter is applied
  let totalPortfolioBalance = null;
  if (portfolio) {
    // Calculate total balance using remaining face value (after deducting sells)
    // Note: remaining_face_value is computed, not a column
    const balanceSql = `SELECT g.deal_number, g.face_value FROM gsec g WHERE g.transaction_type = 'Buy'` +
      (portfolio ? ' AND g.portfolio = ?' : '') +
      (isin ? ' AND g.isin_number = ?' : '') +
      (valueDate ? ' AND g.value_date = ?' : '') +
      (maturityDate ? ' AND g.maturity_date = ?' : '') +
      (asAtDate ? ' AND g.value_date <= ?' : '');
    
    const balanceParams = [];
    if (portfolio) balanceParams.push(portfolio);
    if (isin) balanceParams.push(isin);
    if (valueDate) balanceParams.push(valueDate);
    if (maturityDate) balanceParams.push(maturityDate);
    if (asAtDate) balanceParams.push(asAtDate);
    
    const [balanceRows] = await db.query(balanceSql, balanceParams);
    
    // Calculate remaining face value for each deal (same logic as in main query)
    const dealNumbers = balanceRows.map(r => (r.deal_number || '').trim()).filter(Boolean);
    const soldByDeal = {};
    if (dealNumbers.length) {
      const placeholders = dealNumbers.map(() => '?').join(',');
      let sellSql = `
        SELECT TRIM(buy_deal_number) AS buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
        FROM gsec
        WHERE transaction_type = 'Sell' 
        AND buy_deal_number IS NOT NULL 
        AND TRIM(buy_deal_number) IN (${placeholders})
      `;
      const sellParams = [...dealNumbers];
      
      // Filter by date - ONLY include sells that occurred on or BEFORE the asAtDate
      // Status check is lenient to include pending sells in the count
      if (asAtDate) {
        console.log(`[GSEC Report] Filtering total balance sells for asAtDate: ${asAtDate}`);
        sellSql += ' AND DATE(value_date) <= DATE(?)';
        sellParams.push(asAtDate);
      }
      
      sellSql += ' GROUP BY TRIM(buy_deal_number)';
      const [sellRows] = await db.query(sellSql, sellParams);
      sellRows.forEach(row => {
        const trimmedKey = (row.buy_deal_number || '').trim();
        soldByDeal[trimmedKey] = Number(row.total_sold) || 0;
      });
    }
    
    // Calculate buyback deductions for historical dates
    const buybackByDeal = {};
    if (asAtDate && dealNumbers.length) {
      const placeholders = dealNumbers.map(() => '?').join(',');
      // Check if leg1_transaction_type column exists
      let hasTransactionTypeColumn = false;
      try {
        const [txTypeCheck] = await db.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'buyback_deals' 
          AND COLUMN_NAME = 'leg1_transaction_type'
        `);
        hasTransactionTypeColumn = txTypeCheck.length > 0;
      } catch (schemaError) {
        console.warn('[GSEC Report] Could not check leg1_transaction_type schema for total balance');
      }
      
      let buybackSql = `
        SELECT source_buy_deal_number, COALESCE(SUM(leg1_face_value), 0) AS total_buyback
        FROM buyback_deals
        WHERE`;
      
      if (hasTransactionTypeColumn) {
        buybackSql += ` leg1_transaction_type = 'Sell' AND`;
      }
      
      buybackSql += ` deal_status = 'Approved'
        AND DATE(approved_at) <= ?
        AND (source_buy_deal_number IN (${placeholders}) OR source_buy_deal_number IS NULL)
        GROUP BY source_buy_deal_number
      `;
      const buybackParams = [asAtDate, ...dealNumbers];
      const [buybackRows] = await db.query(buybackSql, buybackParams);
      buybackRows.forEach(row => {
        if (row.source_buy_deal_number) {
          buybackByDeal[row.source_buy_deal_number] = Number(row.total_buyback) || 0;
        }
      });
    }
    
    let totalBalance = 0;
    balanceRows.forEach(balanceRow => {
      const originalFace = Number(balanceRow.face_value) || 0;
      // remaining_face_value is computed, not a column, so always use 0
      const dbRemainingFaceValue = 0;
      // Normalize deal_number by trimming for lookup
      const normalizedDealNumber = (balanceRow.deal_number || '').trim();
      const soldAgainstThisDeal = Number(soldByDeal[normalizedDealNumber] || 0);
      const buybackDeduction = Number(buybackByDeal[normalizedDealNumber] || 0);
      
      // Use same calculation as main query
      const today = new Date().toISOString().split('T')[0];
      const isCurrentDate = asAtDate === today;
      
      let remainingFaceValue;
      if (asAtDate && !isCurrentDate) {
        // For past dates, calculate dynamically including buyback deductions
        remainingFaceValue = Math.max(0, originalFace - soldAgainstThisDeal - buybackDeduction);
      } else if (asAtDate && isCurrentDate) {
        // For today's date, use database value which already includes all deductions
        remainingFaceValue = dbRemainingFaceValue > 0 ? dbRemainingFaceValue : Math.max(0, originalFace - soldAgainstThisDeal);
      } else {
        // For no asAtDate, use database value if available
        remainingFaceValue = dbRemainingFaceValue > 0 ? dbRemainingFaceValue : Math.max(0, originalFace - soldAgainstThisDeal);
      }
      
      totalBalance += remainingFaceValue;
    });
    
    totalPortfolioBalance = formatPrice(totalBalance, 4);
    console.log(`Portfolio ${portfolio} total balance: ${totalPortfolioBalance}`);
  }

  return { data, total: count, totalPortfolioBalance };
  } catch (error) {
    console.error('[GSEC Report Service] Error:', error);
    console.error('[GSEC Report Service] Error message:', error.message);
    console.error('[GSEC Report Service] Error stack:', error.stack);
    throw error; // Re-throw to be caught by controller
  }
};
