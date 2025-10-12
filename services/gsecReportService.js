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
  // Build query with filters - include both regular GSEC deals and leg2 buy transactions from buyback deals
  let sql = `SELECT * FROM (
    -- Regular GSEC deals
    SELECT g.id, g.portfolio, g.custodian, g.deal_number, g.face_value, g.value_date, g.maturity_date, g.isin, g.coupon_interest, g.clean_price, g.yield, g.counterparty, g.transaction_type, 
           im.coupon_rate, im.issue_date, im.coupon_date_1, im.coupon_date_2,
           0 as repo_collateral,
           0 as sell_back,
           'gsec' as source_table
    FROM gsec g 
    LEFT JOIN isin_master im ON g.isin = im.isin_number 
    WHERE 1=1`;
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

  // Add UNION for leg2 buy transactions from buyback deals
  sql += `
    UNION ALL
    
    -- Leg2 buy transactions from buyback deals
    SELECT 
      CONCAT('BB_', bd.id) as id,
      bd.leg2_portfolio COLLATE utf8mb4_unicode_ci as portfolio,
      '' COLLATE utf8mb4_unicode_ci as custodian,
      CONCAT('BB_', bd.deal_number) COLLATE utf8mb4_unicode_ci as deal_number,
      bd.leg2_face_value as face_value,
      bd.leg2_value_date as value_date,
      bd.maturity_date,
      bd.leg2_isin COLLATE utf8mb4_unicode_ci as isin,
      (bd.leg2_face_value * bd.coupon_rate / 100) as coupon_interest,
      bd.leg2_clean_price as clean_price,
      bd.leg2_yield_rate as yield,
      bd.leg2_counterparty COLLATE utf8mb4_unicode_ci as counterparty,
      bd.leg2_transaction_type COLLATE utf8mb4_unicode_ci as transaction_type,
      bd.coupon_rate,
      bd.issue_date,
      bd.coupon_date1,
      bd.coupon_date2,
      0 as repo_collateral,
      0 as sell_back,
      'buyback_leg2' COLLATE utf8mb4_unicode_ci as source_table
    FROM buyback_deals bd
    WHERE bd.leg2_transaction_type = 'Buy' 
      AND bd.deal_status IN ('Approved', 'Settled')`;
  
  // Add buyback filters - add parameters in same order as GSEC section
  if (portfolio) {
    sql += ' AND bd.leg2_portfolio = ?';
    params.push(portfolio);
  }
  if (isin) {
    sql += ' AND bd.leg2_isin = ?';
    params.push(isin);
  }
  if (valueDate) {
    sql += ' AND bd.leg2_value_date = ?';
    params.push(valueDate);
  }
  if (maturityDate) {
    sql += ' AND bd.maturity_date = ?';
    params.push(maturityDate);
  }
  if (asAtDate) {
    sql += ' AND bd.leg2_value_date <= ?';
    params.push(asAtDate);
  }
  
  // Close the subquery and add ordering
  sql += `
  ) combined_deals
  ORDER BY isin, maturity_date, id`;

  // Pagination - only apply if page and pageSize are provided
  if (page && pageSize) {
    const offset = (page - 1) * pageSize;
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
  }

  // Query DB
  const [rows] = await db.query(sql, params);

  // Calculate repo_collateral and sell_back for each deal
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Calculate repo_collateral for this ISIN
    const [repoRows] = await db.query(`
      SELECT COALESCE(SUM(face_value), 0) as repo_collateral
      FROM repo_deals 
      WHERE isin_number = ? AND status IN ('Active', 'Pending')
    `, [row.isin]);
    row.repo_collateral = repoRows[0].repo_collateral;
    
    // Calculate sell_back for this ISIN
    const [sellBackRows] = await db.query(`
      SELECT COALESCE(SUM(CASE WHEN leg1_transaction_type = 'Sell' AND leg2_transaction_type = 'Buy' THEN leg1_face_value ELSE 0 END), 0) as sell_back
      FROM buyback_deals 
      WHERE leg1_isin = ? AND deal_status IN ('Approved', 'Settled')
    `, [row.isin]);
    row.sell_back = sellBackRows[0].sell_back;
  }

  // Get all unique ISINs from the current page results
  const uniqueIsins = [...new Set(rows.map(row => row.isin))];

  // Calculate balance for each ISIN across ALL records (not just current page)
  const isinBalances = {};
  const isinWapMap = {};
  
  for (const isin of uniqueIsins) {
    // Query all records for this ISIN to calculate correct balance
    // Include both GSEC deals and leg2 buy transactions from buyback deals
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
    
    // Add UNION for leg2 buy transactions from buyback deals
    balanceSql += `
      UNION ALL
      SELECT 
        leg2_face_value as face_value, 
        leg2_transaction_type COLLATE utf8mb4_unicode_ci as transaction_type, 
        leg2_clean_price as clean_price
      FROM buyback_deals 
      WHERE leg2_isin = ? 
        AND leg2_transaction_type = 'Buy' 
        AND deal_status IN ('Approved', 'Settled')`;
    balanceParams.push(isin);
    
    // Apply filters for buyback deals
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
    
    balanceSql += ') combined_balance';
    
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

    // Calculate available balance: balance - repo_collateral - sell_back
    const balance = Number(truncate4(isinBalances[row.isin]).toFixed(4));
    const repoCollateral = Number(row.repo_collateral) || 0;
    const sellBack = Number(row.sell_back) || 0;
    const availableBalance = balance - repoCollateral - sellBack;

    return {
      id: row.id,
      portfolio: row.portfolio,
      custodian: row.custodian || '',
      deal_number: row.deal_number || '',
      face_value: formatCurrency(row.face_value, 2),
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

  // Get total count for pagination
  let countParams = [];
  // Parameters for first part of UNION (GSEC deals)
  if (portfolio) countParams.push(portfolio);
  if (isin) countParams.push(isin);
  if (valueDate) countParams.push(valueDate);
  if (maturityDate) countParams.push(maturityDate);
  if (asAtDate) countParams.push(asAtDate);
  // Parameters for second part of UNION (buyback deals)
  if (portfolio) countParams.push(portfolio);
  if (isin) countParams.push(isin);
  if (valueDate) countParams.push(valueDate);
  if (maturityDate) countParams.push(maturityDate);
  if (asAtDate) countParams.push(asAtDate);
  
  // Count query including both GSEC deals and leg2 buy transactions
  let countSql = `SELECT COUNT(*) as count FROM (
    SELECT DISTINCT g.id FROM gsec g 
    LEFT JOIN isin_master im ON g.isin = im.isin_number 
    LEFT JOIN repo_deals rd ON g.isin COLLATE utf8mb4_unicode_ci = rd.isin_number AND rd.status IN ('Active', 'Pending') 
    LEFT JOIN buyback_deals bd ON g.isin COLLATE utf8mb4_unicode_ci = bd.leg1_isin AND bd.deal_status IN ('Approved', 'Settled')
    WHERE 1=1` +
    (portfolio ? ' AND g.portfolio = ?' : '') +
    (isin ? ' AND g.isin = ?' : '') +
    (valueDate ? ' AND g.value_date = ?' : '') +
    (maturityDate ? ' AND g.maturity_date = ?' : '') +
    (asAtDate ? ' AND g.value_date <= ?' : '') +
    `
    UNION ALL
    SELECT DISTINCT CONCAT('BB_', bd.id) as id FROM buyback_deals bd
    WHERE bd.leg2_transaction_type = 'Buy' 
      AND bd.deal_status IN ('Approved', 'Settled')` +
    (portfolio ? ' AND bd.leg2_portfolio = ?' : '') +
    (isin ? ' AND bd.leg2_isin = ?' : '') +
    (valueDate ? ' AND bd.leg2_value_date = ?' : '') +
    (maturityDate ? ' AND bd.maturity_date = ?' : '') +
    (asAtDate ? ' AND bd.leg2_value_date <= ?' : '') +
    `
  ) combined_count`;
  
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
        AND deal_status IN ('Approved', 'Settled')` +
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
