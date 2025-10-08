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
  // Build query with filters - join with isin_master to get required fields for NVP calculation
  // Also join with repo_deals to get repo collateral data
  let sql = `SELECT g.id, g.portfolio, g.custodian, g.deal_number, g.face_value, g.value_date, g.maturity_date, g.isin, g.coupon_interest, g.clean_price, g.yield, g.counterparty, g.transaction_type, 
             im.coupon_rate, im.issue_date, im.coupon_date_1, im.coupon_date_2,
             COALESCE(SUM(rd.face_value), 0) as repo_collateral,
             COALESCE(SUM(CASE WHEN bd.leg1_transaction_type = 'Sell' AND bd.leg2_transaction_type = 'Buy' THEN bd.leg1_face_value ELSE 0 END), 0) as sell_back
             FROM gsec g 
             LEFT JOIN isin_master im ON g.isin = im.isin_number 
             LEFT JOIN repo_deals rd ON g.isin COLLATE utf8mb4_unicode_ci = rd.isin_number AND rd.status IN ('Active', 'Pending')
             LEFT JOIN buyback_deals bd ON g.isin COLLATE utf8mb4_unicode_ci = bd.leg1_isin AND bd.deal_status IN ('Approved', 'Settled')` +
             (portfolio ? ` AND bd.leg1_portfolio = ?` : '') +
             ` WHERE 1=1`;
  const params = [];
  if (portfolio) {
    sql += ' AND g.portfolio = ?';
    params.push(portfolio);
    // Add portfolio parameter for buyback_deals JOIN
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

  sql += ' GROUP BY g.id, g.portfolio, g.custodian, g.deal_number, g.face_value, g.value_date, g.maturity_date, g.isin, g.coupon_interest, g.clean_price, g.yield, g.counterparty, g.transaction_type, im.coupon_rate, im.issue_date, im.coupon_date_1, im.coupon_date_2';
  sql += ' ORDER BY g.isin, g.maturity_date, g.id';

  // Pagination - only apply if page and pageSize are provided
  if (page && pageSize) {
    const offset = (page - 1) * pageSize;
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
  }

  // Query DB
  const [rows] = await db.query(sql, params);

  // Get all unique ISINs from the current page results
  const uniqueIsins = [...new Set(rows.map(row => row.isin))];

  // Calculate balance for each ISIN across ALL records (not just current page)
  const isinBalances = {};
  const isinWapMap = {};
  
  for (const isin of uniqueIsins) {
    // Query all records for this ISIN to calculate correct balance
    // Apply the same filters as the main query to ensure balance is calculated only for the filtered portfolio
    let balanceSql = `SELECT face_value, transaction_type, clean_price FROM gsec WHERE isin = ?`;
    const balanceParams = [isin];
    
    // Apply the same filters as the main query
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
  if (portfolio) countParams.push(portfolio);
  if (isin) countParams.push(isin);
  if (valueDate) countParams.push(valueDate);
  if (maturityDate) countParams.push(maturityDate);
  if (asAtDate) countParams.push(asAtDate);
  
  const [[{ count }]] = await db.query(`SELECT COUNT(DISTINCT g.id) as count FROM gsec g LEFT JOIN isin_master im ON g.isin = im.isin_number LEFT JOIN repo_deals rd ON g.isin COLLATE utf8mb4_unicode_ci = rd.isin_number AND rd.status IN ('Active', 'Pending') LEFT JOIN buyback_deals bd ON g.isin COLLATE utf8mb4_unicode_ci = bd.leg1_isin AND bd.deal_status IN ('Approved', 'Settled') WHERE 1=1` +
    (portfolio ? ' AND g.portfolio = ?' : '') +
    (isin ? ' AND g.isin = ?' : '') +
    (valueDate ? ' AND g.value_date = ?' : '') +
    (maturityDate ? ' AND g.maturity_date = ?' : '') +
    (asAtDate ? ' AND g.value_date <= ?' : ''),
    countParams
  );

  // Calculate total portfolio balance when portfolio filter is applied
  let totalPortfolioBalance = null;
  if (portfolio) {
    // Calculate total balance only for the filtered results (respecting all filters)
    const balanceSql = `SELECT face_value, transaction_type FROM gsec g WHERE 1=1` +
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
