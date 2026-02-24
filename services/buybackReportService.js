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
  
  // Don't paginate here - we'll paginate after expanding deals into legs
  // Query DB - get all matching deals
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
    
    // Query all Buy records for this ISIN to calculate correct balance
    // Only include GSEC Buy transactions - buyback deals are separate
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
    
    // Calculate balance for this ISIN
    isinBalances[isin] = 0;
    isinWapMap[isin] = { sumFV: 0, sumFVCP: 0 };
    
    balanceRows.forEach(balanceRow => {
      // Only Buy transactions contribute to balance
      isinBalances[isin] += Number(balanceRow.face_value);

      // Aggregate for WAP calculation
      const fv = Number(balanceRow.face_value) || 0;
      const cp = Number(balanceRow.clean_price) || 0;
      isinWapMap[isin].sumFV += fv;
      isinWapMap[isin].sumFVCP += fv * cp;
    });
  }
  
  // Format results - create 2 rows per deal (one for each leg)
  const data = [];
  rows.forEach(row => {
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
    
    // Leg 1 row
    data.push({
      id: `${row.id}-leg1`,
      deal_id: row.id,
      deal_number: row.deal_number,
      leg: 'Leg 1',
      transaction_type: row.leg1_transaction_type,
      status: row.deal_status,
      trade_date: row.leg1_trade_date,
      value_date: row.leg1_value_date,
      maturity_date: row.maturity_date,
      isin: row.leg1_isin,
      portfolio: row.leg1_portfolio,
      counterparty: row.leg1_counterparty,
      face_value: Number(row.leg1_face_value) || 0,
      clean_price: Number(row.leg1_clean_price) || 0,
      dirty_price: Number(row.leg1_dirty_price) || 0,
      yield: Number(row.leg1_yield_rate) || 0,
      settlement_amount: Number(row.leg1_settlement_amount) || 0,
      accrued_interest: Number(row.leg1_accrued_interest) || 0,
      currency: row.leg1_currency || 'LKR',
      balance: leg1Balance,
      wap: leg1Wap,
      coupon_rate: Number(row.coupon_rate) || 0,
      notes: row.notes || ''
    });
    
    // Leg 2 row
    data.push({
      id: `${row.id}-leg2`,
      deal_id: row.id,
      deal_number: row.deal_number,
      leg: 'Leg 2',
      transaction_type: row.leg2_transaction_type,
      status: row.deal_status,
      trade_date: row.leg2_trade_date,
      value_date: row.leg2_value_date,
      maturity_date: row.maturity_date,
      isin: row.leg2_isin,
      portfolio: row.leg2_portfolio,
      counterparty: row.leg2_counterparty,
      face_value: Number(row.leg2_face_value) || 0,
      clean_price: Number(row.leg2_clean_price) || 0,
      dirty_price: Number(row.leg2_dirty_price) || 0,
      yield: Number(row.leg2_yield_rate) || 0,
      settlement_amount: Number(row.leg2_settlement_amount) || 0,
      accrued_interest: Number(row.leg2_accrued_interest) || 0,
      currency: row.leg2_currency || 'LKR',
      balance: leg2Balance,
      wap: leg2Wap,
      coupon_rate: Number(row.coupon_rate) || 0,
      notes: row.notes || ''
    });
  });
  
  // Get total count for pagination (count deals, not legs)
  // Since we return 2 rows per deal, the total rows will be count * 2
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
  // Total rows = count of deals * 2 (since each deal has 2 legs)
  const totalRows = count * 2;
  
  // Apply pagination to the expanded data (legs)
  let paginatedData = data;
  if (page && pageSize) {
    const offset = (page - 1) * pageSize;
    paginatedData = data.slice(offset, offset + pageSize);
  }
  
  // Calculate total portfolio balance when portfolio filter is applied
  let totalPortfolioBalance = null;
  if (portfolio) {
    // Calculate total balance only for the filtered results (respecting all filters)
    // Include both GSEC deals and leg2 buy transactions from buyback deals
    const balanceSql = `SELECT face_value, transaction_type FROM (
      SELECT face_value, transaction_type FROM gsec g WHERE 1=1` +
      (portfolio ? ' AND g.portfolio = ?' : '') +
      (isin ? ' AND g.isin_number = ?' : '') +
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
  
  return { data: paginatedData, total: totalRows, totalPortfolioBalance };
};
