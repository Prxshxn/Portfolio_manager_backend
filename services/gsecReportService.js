const db = require('../db'); // adjust if you use a different db import
const { differenceInDays, parseISO } = require('date-fns');
const { calculateNVP } = require('../utils/bondPricingNVP');

// Helper to truncate to 4 decimals
function truncate4(val) {
  return Math.floor(Number(val) * 10000) / 10000;
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
             LEFT JOIN buyback_deals bd ON g.isin COLLATE utf8mb4_unicode_ci = bd.leg1_isin AND bd.deal_status IN ('Approved', 'Settled')
             WHERE 1=1`;
  const params = [];
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

  // Aggregate balance by ISIN
  // Calculate balance per ISIN: buys addition, sells subtraction
  const isinBalances = {};
  const isinWapMap = {};
  rows.forEach(row => {
    const isin = row.isin;
    if (!isinBalances[isin]) isinBalances[isin] = 0;
    if (row.transaction_type && row.transaction_type.toLowerCase() === 'sell') {
      isinBalances[isin] -= Number(row.face_value);
    } else {
      // Treat as buy by default
      isinBalances[isin] += Number(row.face_value);
    }

    // Aggregate for WAP calculation (ignore 'Sell' deals)
    if (!row.transaction_type || row.transaction_type.toLowerCase() !== 'sell') {
      const fv = Number(row.face_value) || 0;
      const cp = Number(row.clean_price) || 0;
      if (!isinWapMap[isin]) {
        isinWapMap[isin] = { sumFV: 0, sumFVCP: 0 };
      }
      isinWapMap[isin].sumFV += fv;
      isinWapMap[isin].sumFVCP += fv * cp;
    }
  });

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

    return {
      id: row.id,
      portfolio: row.portfolio,
      custodian: row.custodian || '',
      deal_number: row.deal_number || '',
      face_value: row.face_value !== undefined ? Number(row.face_value).toFixed(2) : '',
      value_date: row.value_date,
      maturity_date: row.maturity_date,
      isin: row.isin,
      coupon_interest: truncate4(row.coupon_interest).toFixed(4),
      clean_price: truncate4(row.clean_price).toFixed(4),
      yield: truncate4(row.yield).toFixed(4),
      dtm,
      balance: truncate4(isinBalances[row.isin]).toFixed(4),
      wap: (function() {
        const wapData = isinWapMap[row.isin];
        if (wapData && wapData.sumFV) {
          return (Math.floor((wapData.sumFVCP / wapData.sumFV) * 10000) / 10000).toFixed(4);
        }
        return '';
      })(),
      nvp: nvpResult.nvp || '',
      accrued_interest: nvpResult.accruedInterest || '',
      repo_collateral: row.repo_collateral ? truncate4(row.repo_collateral).toFixed(4) : '0.0000',
      sell_back: row.sell_back ? truncate4(row.sell_back).toFixed(2) : '0.00',
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
  
  const [[{ count }]] = await db.query(`SELECT COUNT(DISTINCT g.id) as count FROM gsec g LEFT JOIN isin_master im ON g.isin = im.isin_number LEFT JOIN repo_deals rd ON g.isin COLLATE utf8mb4_unicode_ci = rd.isin_number AND rd.status IN ('Active', 'Pending') LEFT JOIN buyback_deals bd ON g.isin COLLATE utf8mb4_unicode_ci = bd.leg1_isin AND bd.deal_status IN ('Approved', 'Settled') WHERE 1=1` +
    (portfolio ? ' AND g.portfolio = ?' : '') +
    (isin ? ' AND g.isin = ?' : '') +
    (valueDate ? ' AND g.value_date = ?' : '') +
    (maturityDate ? ' AND g.maturity_date = ?' : ''),
    countParams
  );

  return { data, total: count };
};
