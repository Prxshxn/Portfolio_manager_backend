const db = require('../config/db');

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

exports.getBuybackReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, page, pageSize }) => {
  // Build query with filters for buyback deals
  let sql = `
    SELECT 
      bd.id,
      bd.deal_number,
      bd.deal_status,
      bd.created_at,
      bd.leg1_trade_date,
      bd.leg1_value_date,
      bd.leg1_transaction_type,
      bd.leg1_isin,
      bd.leg1_counterparty,
      bd.leg1_portfolio,
      bd.leg1_face_value,
      bd.leg1_yield_rate,
      bd.leg1_settlement_amount,
      bd.leg1_clean_price,
      bd.leg1_dirty_price,
      bd.leg1_accrued_interest,
      bd.leg1_currency,
      bd.leg2_trade_date,
      bd.leg2_value_date,
      bd.leg2_transaction_type,
      bd.leg2_isin,
      bd.leg2_counterparty,
      bd.leg2_portfolio,
      bd.leg2_face_value,
      bd.leg2_yield_rate,
      bd.leg2_settlement_amount,
      bd.leg2_clean_price,
      bd.leg2_dirty_price,
      bd.leg2_accrued_interest,
      bd.leg2_currency,
      bd.maturity_date,
      bd.coupon_rate,
      bd.issue_date,
      bd.coupon_date1,
      bd.coupon_date2,
      bd.notes,
      bd.verified_by,
      bd.verified_at,
      bd.approved_by,
      bd.approved_at
    FROM buyback_deals bd
    WHERE 1=1
  `;
  
  const params = [];
  
  // Add filters
  if (portfolio) {
    sql += ' AND (bd.leg1_portfolio = ? OR bd.leg2_portfolio = ?)';
    params.push(portfolio, portfolio);
  }
  if (isin) {
    sql += ' AND (bd.leg1_isin = ? OR bd.leg2_isin = ?)';
    params.push(isin, isin);
  }
  if (valueDate) {
    sql += ' AND (bd.leg1_value_date = ? OR bd.leg2_value_date = ?)';
    params.push(valueDate, valueDate);
  }
  if (maturityDate) {
    sql += ' AND bd.maturity_date = ?';
    params.push(maturityDate);
  }
  if (asAtDate) {
    sql += ' AND (bd.leg1_value_date <= ? OR bd.leg2_value_date <= ?)';
    params.push(asAtDate, asAtDate);
  }
  
  sql += ' ORDER BY bd.created_at DESC';
  
  // Pagination
  if (page && pageSize) {
    const offset = (page - 1) * pageSize;
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
  }
  
  // Query DB
  const [rows] = await db.query(sql, params);
  
  // Get all unique ISINs from the current page results
  const uniqueIsins = [...new Set([
    ...rows.map(row => row.leg1_isin),
    ...rows.map(row => row.leg2_isin)
  ])];
  
  // Calculate balance for each ISIN across ALL records (not just current page)
  const isinBalances = {};
  const isinWapMap = {};
  
  for (const isin of uniqueIsins) {
    if (!isin) continue; // Skip null/undefined ISINs
    
    // Query all records for this ISIN to calculate correct balance
    // Include both GSEC deals and buyback deals
    let balanceSql = `SELECT face_value, transaction_type, clean_price FROM (
      SELECT face_value, transaction_type, clean_price FROM gsec WHERE isin = ?`;
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
    
    balanceSql += `
      UNION ALL
      SELECT 
        leg2_face_value as face_value, 
        leg2_transaction_type COLLATE utf8mb4_unicode_ci as transaction_type,
        0 as clean_price
      FROM buyback_deals 
      WHERE leg2_isin = ? 
        AND leg2_transaction_type = 'Buy' 
        AND deal_status IN ('Approved', 'Settled', 'Pending_Verification')`;
    
    balanceParams.push(isin);
    
    // Apply the same filters for buyback deals
    if (portfolio) {
      balanceSql += ' AND leg2_portfolio = ?';
      balanceParams.push(portfolio);
    }
    if (valueDate) {
      balanceSql += ' AND leg2_value_date = ?';
      balanceParams.push(valueDate);
    }
    if (maturityDate) {
      balanceSql += ' AND maturity_date = ?';
      balanceParams.push(maturityDate);
    }
    if (asAtDate) {
      balanceSql += ' AND leg2_value_date <= ?';
      balanceParams.push(asAtDate);
    }
    
    balanceSql += `
    ) combined_balance`;
    
    const [balanceRows] = await db.query(balanceSql, balanceParams);
    
    // Calculate balance for this ISIN
    isinBalances[isin] = 0;
    isinWapMap[isin] = { sumFV: 0, sumFVCP: 0 };
    
    balanceRows.forEach(balanceRow => {
      if (balanceRow.transaction_type && balanceRow.transaction_type.toLowerCase() === 'sell') {
        isinBalances[isin] -= Number(balanceRow.face_value);
      } else {
        // Treat as buy by default
        isinBalances[isin] += Number(balanceRow.face_value);
      }

      // Aggregate for WAP calculation (ignore 'Sell' deals)
      if (!balanceRow.transaction_type || balanceRow.transaction_type.toLowerCase() !== 'sell') {
        const fv = Number(balanceRow.face_value) || 0;
        const cp = Number(balanceRow.clean_price) || 0;
        isinWapMap[isin].sumFV += fv;
        isinWapMap[isin].sumFVCP += fv * cp;
      }
    });
  }
  
  // Format results
  const data = rows.map(row => {
    // Calculate available balance for leg1 ISIN
    const leg1Balance = isinBalances[row.leg1_isin] || 0;
    const leg1Wap = (() => {
      const wapData = isinWapMap[row.leg1_isin];
      if (wapData && wapData.sumFV) {
        return Math.floor((wapData.sumFVCP / wapData.sumFV) * 10000) / 10000;
      }
      return 0;
    })();
    
    // Calculate available balance for leg2 ISIN
    const leg2Balance = isinBalances[row.leg2_isin] || 0;
    const leg2Wap = (() => {
      const wapData = isinWapMap[row.leg2_isin];
      if (wapData && wapData.sumFV) {
        return Math.floor((wapData.sumFVCP / wapData.sumFV) * 10000) / 10000;
      }
      return 0;
    })();
    
    return {
      id: row.id,
      deal_number: row.deal_number,
      deal_status: row.deal_status,
      created_at: row.created_at,
      maturity_date: row.maturity_date,
      coupon_rate: formatPercentage(row.coupon_rate, 4),
      issue_date: row.issue_date,
      coupon_date1: row.coupon_date1,
      coupon_date2: row.coupon_date2,
      notes: row.notes || '',
      verified_by: row.verified_by,
      verified_at: row.verified_at,
      approved_by: row.approved_by,
      approved_at: row.approved_at,
      
      // Leg 1 data
      leg1: {
        trade_date: row.leg1_trade_date,
        value_date: row.leg1_value_date,
        transaction_type: row.leg1_transaction_type,
        isin: row.leg1_isin,
        counterparty: row.leg1_counterparty,
        portfolio: row.leg1_portfolio,
        face_value: formatCurrency(row.leg1_face_value, 2),
        yield_rate: formatPercentage(row.leg1_yield_rate, 4),
        settlement_amount: formatCurrency(row.leg1_settlement_amount, 2),
        clean_price: formatPrice(row.leg1_clean_price, 4),
        dirty_price: formatPrice(row.leg1_dirty_price, 4),
        accrued_interest: formatPrice(row.leg1_accrued_interest, 4),
        currency: row.leg1_currency,
        balance: formatPrice(leg1Balance, 4),
        wap: formatPrice(leg1Wap, 4)
      },
      
      // Leg 2 data
      leg2: {
        trade_date: row.leg2_trade_date,
        value_date: row.leg2_value_date,
        transaction_type: row.leg2_transaction_type,
        isin: row.leg2_isin,
        counterparty: row.leg2_counterparty,
        portfolio: row.leg2_portfolio,
        face_value: formatCurrency(row.leg2_face_value, 2),
        yield_rate: formatPercentage(row.leg2_yield_rate, 4),
        settlement_amount: formatCurrency(row.leg2_settlement_amount, 2),
        clean_price: formatPrice(row.leg2_clean_price, 4),
        dirty_price: formatPrice(row.leg2_dirty_price, 4),
        accrued_interest: formatPrice(row.leg2_accrued_interest, 4),
        currency: row.leg2_currency,
        balance: formatPrice(leg2Balance, 4),
        wap: formatPrice(leg2Wap, 4)
      }
    };
  });
  
  // Get total count for pagination
  let countSql = 'SELECT COUNT(*) as count FROM buyback_deals bd WHERE 1=1';
  const countParams = [];
  
  if (portfolio) {
    countSql += ' AND (bd.leg1_portfolio = ? OR bd.leg2_portfolio = ?)';
    countParams.push(portfolio, portfolio);
  }
  if (isin) {
    countSql += ' AND (bd.leg1_isin = ? OR bd.leg2_isin = ?)';
    countParams.push(isin, isin);
  }
  if (valueDate) {
    countSql += ' AND (bd.leg1_value_date = ? OR bd.leg2_value_date = ?)';
    countParams.push(valueDate, valueDate);
  }
  if (maturityDate) {
    countSql += ' AND bd.maturity_date = ?';
    countParams.push(maturityDate);
  }
  if (asAtDate) {
    countSql += ' AND (bd.leg1_value_date <= ? OR bd.leg2_value_date <= ?)';
    countParams.push(asAtDate, asAtDate);
  }
  
  const [[{ count }]] = await db.query(countSql, countParams);
  
  // Calculate total portfolio balance when portfolio filter is applied
  let totalPortfolioBalance = null;
  if (portfolio) {
    // Calculate total balance only for the filtered results (respecting all filters)
    // Include both GSEC deals and leg2 buy transactions from buyback deals
    const balanceSql = `SELECT face_value, transaction_type FROM (
      SELECT face_value, transaction_type FROM gsec g WHERE 1=1` +
      (portfolio ? ' AND g.portfolio = ?' : '') +
      (isin ? ' AND g.isin = ?' : '') +
      (valueDate ? ' AND g.value_date = ?' : '') +
      (maturityDate ? ' AND g.maturity_date = ?' : '') +
      (asAtDate ? ' AND g.value_date <= ?' : '') +
      `
      UNION ALL
      SELECT 
        leg2_face_value as face_value, 
        leg2_transaction_type COLLATE utf8mb4_unicode_ci as transaction_type
      FROM buyback_deals 
      WHERE leg2_transaction_type = 'Buy' 
        AND deal_status IN ('Approved', 'Settled', 'Pending_Verification')` +
      (portfolio ? ' AND leg2_portfolio = ?' : '') +
      (isin ? ' AND leg2_isin = ?' : '') +
      (valueDate ? ' AND leg2_value_date = ?' : '') +
      (maturityDate ? ' AND maturity_date = ?' : '') +
      (asAtDate ? ' AND leg2_value_date <= ?' : '') +
      `
    ) combined_balance`;
    
    const balanceParams = [];
    if (portfolio) balanceParams.push(portfolio);
    if (isin) balanceParams.push(isin);
    if (valueDate) balanceParams.push(valueDate);
    if (maturityDate) balanceParams.push(maturityDate);
    if (asAtDate) balanceParams.push(asAtDate);
    // Add parameters for buyback deals
    if (portfolio) balanceParams.push(portfolio);
    if (isin) balanceParams.push(isin);
    if (valueDate) balanceParams.push(valueDate);
    if (maturityDate) balanceParams.push(maturityDate);
    if (asAtDate) balanceParams.push(asAtDate);
    
    const [balanceRows] = await db.query(balanceSql, balanceParams);
    
    let totalBalance = 0;
    balanceRows.forEach(balanceRow => {
      if (balanceRow.transaction_type && balanceRow.transaction_type.toLowerCase() === 'sell') {
        totalBalance -= Number(balanceRow.face_value);
      } else {
        totalBalance += Number(balanceRow.face_value);
      }
    });
    
    totalPortfolioBalance = formatPrice(totalBalance, 4);
  }
  
  return { data, total: count, totalPortfolioBalance };
};
