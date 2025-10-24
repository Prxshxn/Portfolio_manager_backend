const db = require('../db'); // adjust if you use a different db import
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
  // Build query with filters - only include Buy transactions from GSEC deals
  let sql = `SELECT g.id, g.portfolio, g.custodian, g.deal_number, g.face_value, g.remaining_face_value, g.value_date, g.maturity_date, g.isin, g.coupon_interest, g.clean_price, g.yield, g.counterparty, g.transaction_type, 
             im.coupon_rate, im.issue_date, im.coupon_date_1, im.coupon_date_2
    FROM gsec g 
    LEFT JOIN isin_master im ON g.isin = im.isin_number 
    WHERE g.transaction_type = 'Buy'`;
  const params = [];
  
  // Add GSEC filters
  if (portfolio) {
    sql += ' AND g.portfolio = ?';
    params.push(portfolio);
  }
  if (isin) {
    sql += ' AND g.isin = ?';
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
  sql += ` ORDER BY g.isin, g.maturity_date, g.id`;

  // Pagination - only apply if page and pageSize are provided
  if (page && pageSize) {
    const offset = (page - 1) * pageSize;
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
  }

  // Query DB
  const [rows] = await db.query(sql, params);

  // Build a map of total sold per buy deal_number to compute remaining face value per row
  const dealNumbers = rows.map(r => r.deal_number).filter(Boolean);
  const soldByDeal = {};
  if (dealNumbers.length) {
    // Grouped query to sum sells referencing these buy deals
    // Include asAtDate filter for backdating support
    const placeholders = dealNumbers.map(() => '?').join(',');
    let sellRefSql = `
      SELECT buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
      FROM gsec
      WHERE transaction_type = 'Sell' AND buy_deal_number IN (${placeholders})
    `;
    const sellRefParams = [...dealNumbers];
    
    // Add asAtDate filter for backdating - only include sell transactions on or before asAtDate
    if (asAtDate) {
      sellRefSql += ' AND value_date <= ?';
      sellRefParams.push(asAtDate);
    }
    
    sellRefSql += ' GROUP BY buy_deal_number';
    
    const [sellRefRows] = await db.query(sellRefSql, sellRefParams);
    sellRefRows.forEach(r => {
      soldByDeal[r.buy_deal_number] = Number(r.total_sold) || 0;
    });
  }

  // Calculate repo_collateral for each deal and derive remaining face value for display
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Calculate repo_collateral for this ISIN
    const [repoRows] = await db.query(`
      SELECT COALESCE(SUM(face_value), 0) as repo_collateral
      FROM repo_deals 
      WHERE isin_number = ? AND status IN ('Active', 'Pending')
    `, [row.isin]);
    row.repo_collateral = repoRows[0].repo_collateral;
    
    // Use the remaining_face_value from database (which includes buyback deductions)
    // Only fall back to dynamic calculation if remaining_face_value is null/undefined
    const soldAgainstThisDeal = Number(soldByDeal[row.deal_number] || 0);
    const originalFace = Number(row.face_value) || 0;
    const dbRemainingFaceValue = Number(row.remaining_face_value) || 0;
    
    console.log(`Deal ${row.deal_number}: originalFace=${originalFace}, dbRemainingFaceValue=${dbRemainingFaceValue}, soldAgainstThisDeal=${soldAgainstThisDeal}`);
    
    // Calculate buyback deductions with backdating support
    let buybackDeduction = 0;
    if (asAtDate) {
      // Query buyback deals that were approved on or before asAtDate
      const [buybackRows] = await db.query(`
        SELECT leg1_face_value, source_buy_deal_number
        FROM buyback_deals 
        WHERE leg1_isin = ? AND leg1_portfolio = ? 
        AND leg1_transaction_type = 'Sell' 
        AND deal_status = 'Approved'
        AND DATE(approved_at) <= ?
        AND (source_buy_deal_number = ? OR source_buy_deal_number IS NULL)
      `, [row.isin, row.portfolio, asAtDate, row.deal_number]);
      
      buybackRows.forEach(buybackRow => {
        // If source_buy_deal_number matches this deal, or if it's null (chronological deduction)
        if (buybackRow.source_buy_deal_number === row.deal_number || !buybackRow.source_buy_deal_number) {
          buybackDeduction += Number(buybackRow.leg1_face_value) || 0;
        }
      });
      
      console.log(`Deal ${row.deal_number}: buybackDeduction=${buybackDeduction} for asAtDate=${asAtDate}`);
    } else {
      // For no asAtDate, use database remaining_face_value which includes all deductions
      buybackDeduction = 0; // Database value already includes buyback deductions
    }

    // Calculate final remaining face value
    const today = new Date().toISOString().split('T')[0];
    const isCurrentDate = asAtDate === today;
    
    if (asAtDate) {
      // For any asAtDate (including today), calculate dynamically including buyback deductions
      row.remaining_face_value_report = Math.max(0, originalFace - soldAgainstThisDeal - buybackDeduction);
    } else {
      // For no asAtDate, use database value if available, otherwise calculate dynamically
      row.remaining_face_value_report = dbRemainingFaceValue > 0 ? dbRemainingFaceValue : Math.max(0, originalFace - soldAgainstThisDeal);
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
      let balanceSql = `SELECT face_value, clean_price FROM gsec WHERE isin = ? AND transaction_type = 'Buy'`;
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
      let sellSql = `SELECT COALESCE(SUM(face_value), 0) AS sold FROM gsec WHERE isin = ? AND transaction_type = 'Sell'`;
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
        sellSql += ' AND value_date <= ?';
        sellParams.push(asAtDate);
      }

      const [sellAggRows] = await db.query(sellSql, sellParams);
      const totalSoldForIsin = Number(sellAggRows?.[0]?.sold || 0);
      isinBalances[isin] = Math.max(0, Number(isinBalances[isin]) - totalSoldForIsin);

      // Subtract buyback deductions for this ISIN with backdating support
      if (asAtDate) {
        let buybackSql = `
          SELECT COALESCE(SUM(leg1_face_value), 0) AS buyback_deduction
          FROM buyback_deals 
          WHERE leg1_isin = ? AND leg1_transaction_type = 'Sell' 
          AND deal_status = 'Approved' AND approved_at <= ?
        `;
        const buybackParams = [isin, asAtDate];
        
        if (portfolio) {
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

  // Get current system date for NVP calculation
  const systemDate = new Date().toISOString().split('T')[0];

  // Format results
  const data = rows.map(row => {
    const maturityDateObj = safeParseISO(row.maturity_date);
    const asAtDateObj = safeParseISO(asAtDate);
    let dtm = '';
    if (maturityDateObj && asAtDateObj) {
      dtm = differenceInDays(maturityDateObj, asAtDateObj);
    }

    // Calculate NVP using system date as value date
    const nvpResult = calculateNVP({
      faceValue: row.face_value,
      couponRate: row.coupon_rate,
      yieldRate: row.yield,
      systemDate: systemDate,
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
      portfolio: row.portfolio,
      custodian: row.custodian || '',
      deal_number: row.deal_number || '',
      // Show remaining face value in the Face Value column (original minus linked sells)
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
      counterparty: row.counterparty || '',
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
    LEFT JOIN isin_master im ON g.isin = im.isin_number 
    WHERE g.transaction_type = 'Buy'` +
    (portfolio ? ' AND g.portfolio = ?' : '') +
    (isin ? ' AND g.isin = ?' : '') +
    (valueDate ? ' AND g.value_date = ?' : '') +
    (maturityDate ? ' AND g.maturity_date = ?' : '') +
    (asAtDate ? ' AND g.value_date <= ?' : '');
  
  const [[{ count }]] = await db.query(countSql, countParams);

  // Calculate total portfolio balance when portfolio filter is applied
  let totalPortfolioBalance = null;
  if (portfolio) {
    // Calculate total balance using remaining face value (after deducting sells)
    const balanceSql = `SELECT g.deal_number, g.face_value, g.remaining_face_value FROM gsec g WHERE g.transaction_type = 'Buy'` +
      (portfolio ? ' AND g.portfolio = ?' : '') +
      (isin ? ' AND g.isin = ?' : '') +
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
    const dealNumbers = balanceRows.map(r => r.deal_number).filter(Boolean);
    const soldByDeal = {};
    if (dealNumbers.length) {
      const placeholders = dealNumbers.map(() => '?').join(',');
      const sellSql = `
        SELECT buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
        FROM gsec
        WHERE transaction_type = 'Sell' AND buy_deal_number IN (${placeholders})
        ${asAtDate ? ' AND value_date <= ?' : ''}
        GROUP BY buy_deal_number
      `;
      const sellParams = [...dealNumbers];
      if (asAtDate) sellParams.push(asAtDate);
      const [sellRows] = await db.query(sellSql, sellParams);
      sellRows.forEach(row => {
        soldByDeal[row.buy_deal_number] = Number(row.total_sold) || 0;
      });
    }
    
    let totalBalance = 0;
    balanceRows.forEach(balanceRow => {
      const originalFace = Number(balanceRow.face_value) || 0;
      const dbRemainingFaceValue = Number(balanceRow.remaining_face_value) || 0;
      const soldAgainstThisDeal = Number(soldByDeal[balanceRow.deal_number] || 0);
      
      // Use same calculation as main query
      const today = new Date().toISOString().split('T')[0];
      const isCurrentDate = asAtDate === today;
      
      let remainingFaceValue;
      if (asAtDate && !isCurrentDate) {
        remainingFaceValue = Math.max(0, originalFace - soldAgainstThisDeal);
      } else {
        remainingFaceValue = dbRemainingFaceValue > 0 ? dbRemainingFaceValue : Math.max(0, originalFace - soldAgainstThisDeal);
      }
      
      totalBalance += remainingFaceValue;
    });
    
    totalPortfolioBalance = formatPrice(totalBalance, 4);
    console.log(`Portfolio ${portfolio} total balance: ${totalPortfolioBalance}`);
  }

  return { data, total: count, totalPortfolioBalance };
};
