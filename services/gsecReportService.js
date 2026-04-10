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
    let sql = `SELECT g.id, g.portfolio, g.deal_number, g.face_value, g.value_date, g.maturity_date, g.isin_number as isin, g.coupon_interest, g.clean_price, g.dirty_price, g.yield, g.counterparty_id, g.transaction_type, 
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

  // Fallback: allocate "unlinked" sells (missing/invalid buy_deal_number) using FIFO per ISIN/portfolio.
  // This makes the report resilient when sell rows do not correctly reference a buy deal_number.
  // Primary linkage remains buy_deal_number; fallback is only for sells not linked to any buy in `rows`.
  if (rows.length) {
    const uniqueIsinsForAllocation = [...new Set(rows.map(r => r.isin).filter(Boolean))];
    if (uniqueIsinsForAllocation.length) {
      const ph = uniqueIsinsForAllocation.map(() => '?').join(',');
      let sellAllocSql = `
        SELECT id, portfolio, isin_number AS isin, face_value, TRIM(buy_deal_number) AS buy_deal_number, value_date
        FROM gsec
        WHERE transaction_type = 'Sell' AND isin_number IN (${ph})
      `;
      const sellAllocParams = [...uniqueIsinsForAllocation];
      if (portfolio) {
        sellAllocSql += ' AND portfolio = ?';
        sellAllocParams.push(portfolio);
      }
      if (asAtDate) {
        sellAllocSql += ' AND DATE(value_date) <= DATE(?)';
        sellAllocParams.push(asAtDate);
      }
      sellAllocSql += ' ORDER BY DATE(value_date), id';

      const [sellAllocRows] = await db.query(sellAllocSql, sellAllocParams);

      // Build FIFO buy lists per (portfolio|isin)
      const buyDealsByKey = {};
      rows.forEach(b => {
        const dealNo = (b.deal_number || '').trim();
        if (!dealNo || !b.isin) return;
        const key = `${String(b.portfolio || '').trim()}|${String(b.isin).trim()}`;
        if (!buyDealsByKey[key]) buyDealsByKey[key] = [];
        buyDealsByKey[key].push({
          deal_number: dealNo,
          face_value: Number(b.face_value) || 0,
          value_date: b.value_date,
          id: Number(b.id) || 0
        });
      });
      Object.keys(buyDealsByKey).forEach(key => {
        buyDealsByKey[key].sort((a, b) => {
          const ad = a.value_date ? String(a.value_date) : '';
          const bd = b.value_date ? String(b.value_date) : '';
          if (ad !== bd) return ad.localeCompare(bd);
          return (a.id || 0) - (b.id || 0);
        });
      });

      const buyDealSet = new Set(dealNumbers.map(d => d.trim()));

      for (const s of sellAllocRows) {
        const linkedDeal = (s.buy_deal_number || '').trim();
        // If sell is properly linked to a buy deal in this report, it was already counted in the grouped sell query above.
        if (linkedDeal && buyDealSet.has(linkedDeal)) continue;

        const sellKey = `${String(s.portfolio || '').trim()}|${String(s.isin || '').trim()}`;
        const fifoBuys = buyDealsByKey[sellKey];
        if (!fifoBuys || !fifoBuys.length) continue;

        let remainingToAllocate = Number(s.face_value) || 0;
        if (remainingToAllocate <= 0) continue;

        for (const b of fifoBuys) {
          if (remainingToAllocate <= 0) break;
          const alreadySold = Number(soldByDeal[b.deal_number] || 0);
          const maxSellable = Math.max(0, (Number(b.face_value) || 0) - alreadySold);
          if (maxSellable <= 0) continue;
          const alloc = Math.min(maxSellable, remainingToAllocate);
          soldByDeal[b.deal_number] = alreadySold + alloc;
          remainingToAllocate -= alloc;
        }
      }
    }
  }

  // ── ONE-TIME schema checks (avoid repeating inside loops) ──
  let hasPortfolioColumn = false;
  let hasTransactionTypeColumn = false;
  try {
    const [schemaCols] = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buyback_deals'
        AND COLUMN_NAME IN ('leg1_portfolio', 'leg1_transaction_type')
    `);
    const colSet = new Set(schemaCols.map(r => r.COLUMN_NAME));
    hasPortfolioColumn = colSet.has('leg1_portfolio');
    hasTransactionTypeColumn = colSet.has('leg1_transaction_type');
  } catch (_) { /* leave both false */ }

  // ── BATCH repo_collateral by unique ISIN (2 queries total, not 2×N) ──
  const uniqueIsins = [...new Set(rows.map(r => r.isin).filter(Boolean))];
  const repoCollateralByIsin = {};
  if (uniqueIsins.length) {
    // Always compute portfolio balances as-of a date.
    // If caller does not pass asAtDate, default to current day so future-dated legs
    // (e.g., buyback leg2 buys) do not offset today's sell-side deductions.
    const effectiveAsAtDate = asAtDate || new Date().toISOString().split('T')[0];
    const ph = uniqueIsins.map(() => '?').join(',');
    const [childRows] = await db.query(`
      SELECT rdi.isin_number, COALESCE(SUM(rdi.face_value), 0) AS rc
      FROM repo_deal_isins rdi JOIN repo_deals rd ON rd.id = rdi.repo_deal_id
      WHERE rdi.isin_number IN (${ph}) AND rd.status IN ('Active','Pending')
      GROUP BY rdi.isin_number`, uniqueIsins);
    childRows.forEach(r => { repoCollateralByIsin[r.isin_number] = Number(r.rc) || 0; });

    const [legacyRows] = await db.query(`
      SELECT rd.isin_number, COALESCE(SUM(rd.face_value), 0) AS rc
      FROM repo_deals rd LEFT JOIN repo_deal_isins rdi ON rdi.repo_deal_id = rd.id
      WHERE rdi.id IS NULL AND rd.isin_number IN (${ph}) AND rd.status IN ('Active','Pending')
      GROUP BY rd.isin_number`, uniqueIsins);
    legacyRows.forEach(r => {
      repoCollateralByIsin[r.isin_number] = (repoCollateralByIsin[r.isin_number] || 0) + (Number(r.rc) || 0);
    });
  }

  // ── BATCH buyback deductions for ALL deal numbers in one query ──
  const allDealNumbers = rows.map(r => (r.deal_number || '').trim()).filter(Boolean);
  const buybackByDealBatch = {};
  if (allDealNumbers.length) {
    const uniqueIsinsForBB = [...new Set(rows.map(r => r.isin).filter(Boolean))];
    const ph = allDealNumbers.map(() => '?').join(',');
    const isinPh = uniqueIsinsForBB.map(() => '?').join(',');
    let bbSql = `SELECT leg1_face_value, source_buy_deal_number, leg1_isin
      FROM buyback_deals WHERE deal_status = 'Approved'`;
    const bbParams = [];
    if (hasTransactionTypeColumn) bbSql += ` AND leg1_transaction_type = 'Sell'`;
    const bbCutoffDate = asAtDate || new Date().toISOString().split('T')[0];
    bbSql += ` AND DATE(approved_at) <= DATE(?)`; bbParams.push(bbCutoffDate);
    bbSql += ` AND (source_buy_deal_number IN (${ph}) OR (source_buy_deal_number IS NULL AND leg1_isin IN (${isinPh})))`;
    bbParams.push(...allDealNumbers, ...uniqueIsinsForBB);
    if (hasPortfolioColumn && portfolio) { bbSql += ` AND leg1_portfolio = ?`; bbParams.push(portfolio); }
    bbSql += ` ORDER BY approved_at ASC`;
    const [bbRows] = await db.query(bbSql, bbParams);

    // Build ISIN → buy deals (FIFO by value_date) for allocating NULL-source buybacks
    const buyDealsByIsin = {};
    rows.forEach(r => {
      const dealNo = (r.deal_number || '').trim();
      if (!dealNo || !r.isin) return;
      if (!buyDealsByIsin[r.isin]) buyDealsByIsin[r.isin] = [];
      buyDealsByIsin[r.isin].push({ deal_number: dealNo, face_value: Number(r.face_value) || 0 });
    });

    bbRows.forEach(r => {
      const key = (r.source_buy_deal_number || '').trim();
      const amount = Number(r.leg1_face_value) || 0;
      if (key) {
        buybackByDealBatch[key] = (buybackByDealBatch[key] || 0) + amount;
      } else if (r.leg1_isin) {
        // NULL source — allocate FIFO to buy deals with matching ISIN
        const candidates = buyDealsByIsin[r.leg1_isin];
        if (!candidates) return;
        let remaining = amount;
        for (const c of candidates) {
          if (remaining <= 0) break;
          const alreadyDeducted = Number(buybackByDealBatch[c.deal_number] || 0);
          const soldAgainst = Number(soldByDeal[c.deal_number] || 0);
          const available = Math.max(0, c.face_value - soldAgainst - alreadyDeducted);
          if (available <= 0) continue;
          const alloc = Math.min(remaining, available);
          buybackByDealBatch[c.deal_number] = alreadyDeducted + alloc;
          remaining -= alloc;
        }
      }
    });
  }

  // ── Per-row calculations (no DB queries inside) ──
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    row.repo_collateral = repoCollateralByIsin[row.isin] || 0;

    const normalizedDealNumber = (row.deal_number || '').trim();
    const soldAgainstThisDeal = Number(soldByDeal[normalizedDealNumber] || 0);
    const originalFace = Number(row.face_value) || 0;
    const buybackDeduction = Number(buybackByDealBatch[normalizedDealNumber] || 0);

    row.remaining_face_value_report = Math.max(0, originalFace - soldAgainstThisDeal - buybackDeduction);
    row.sell_back = 0;
  }

  // ── BATCH ISIN balance + WAP (one query for buys, one for sells, one for buyback) ──
  const isinBalances = {};
  const isinWapMap = {};
  const effectiveAsAtDate = asAtDate || new Date().toISOString().split('T')[0];

  if (uniqueIsins.length) {
    const ph = uniqueIsins.map(() => '?').join(',');

    // Buy totals per ISIN
    let buySql = `SELECT isin_number, SUM(face_value) AS total_fv, SUM(face_value * clean_price) AS sum_fvcp
      FROM gsec WHERE isin_number IN (${ph}) AND transaction_type = 'Buy'`;
    const buyParams = [...uniqueIsins];
    if (portfolio) { buySql += ' AND portfolio = ?'; buyParams.push(portfolio); }
    if (valueDate) { buySql += ' AND value_date = ?'; buyParams.push(valueDate); }
    if (maturityDate) { buySql += ' AND maturity_date = ?'; buyParams.push(maturityDate); }
    buySql += ' AND DATE(value_date) <= DATE(?)';
    buyParams.push(effectiveAsAtDate);
    buySql += ' GROUP BY isin_number';
    const [buyAggRows] = await db.query(buySql, buyParams);
    buyAggRows.forEach(r => {
      isinBalances[r.isin_number] = Number(r.total_fv) || 0;
      isinWapMap[r.isin_number] = { sumFV: Number(r.total_fv) || 0, sumFVCP: Number(r.sum_fvcp) || 0 };
    });

    // Sell totals per ISIN
    let sellSql = `SELECT isin_number, COALESCE(SUM(face_value), 0) AS sold
      FROM gsec WHERE isin_number IN (${ph}) AND transaction_type = 'Sell'`;
    const sellParams = [...uniqueIsins];
    if (portfolio) { sellSql += ' AND portfolio = ?'; sellParams.push(portfolio); }
    if (valueDate) { sellSql += ' AND value_date = ?'; sellParams.push(valueDate); }
    if (maturityDate) { sellSql += ' AND maturity_date = ?'; sellParams.push(maturityDate); }
    sellSql += ' AND DATE(value_date) <= DATE(?)';
    sellParams.push(effectiveAsAtDate);
    sellSql += ' GROUP BY isin_number';
    const [sellAggRows] = await db.query(sellSql, sellParams);
    sellAggRows.forEach(r => {
      isinBalances[r.isin_number] = Math.max(0, (isinBalances[r.isin_number] || 0) - (Number(r.sold) || 0));
    });

    // Buyback deductions per ISIN (single batched query)
    let bbIsinSql = `SELECT leg1_isin, COALESCE(SUM(leg1_face_value), 0) AS bb
      FROM buyback_deals WHERE leg1_isin IN (${ph}) AND deal_status = 'Approved'`;
    const bbIsinParams = [...uniqueIsins];
    if (hasTransactionTypeColumn) bbIsinSql += ` AND leg1_transaction_type = 'Sell'`;
    bbIsinSql += ` AND DATE(approved_at) <= DATE(?)`;
    bbIsinParams.push(effectiveAsAtDate);
    if (hasPortfolioColumn && portfolio) { bbIsinSql += ' AND leg1_portfolio = ?'; bbIsinParams.push(portfolio); }
    bbIsinSql += ' GROUP BY leg1_isin';
    const [bbIsinRows] = await db.query(bbIsinSql, bbIsinParams);
    bbIsinRows.forEach(r => {
      isinBalances[r.leg1_isin] = Math.max(0, (isinBalances[r.leg1_isin] || 0) - (Number(r.bb) || 0));
    });
  }
  // Fill defaults for ISINs with no buy data
  uniqueIsins.forEach(isin => {
    if (!(isin in isinBalances)) isinBalances[isin] = 0;
    if (!(isin in isinWapMap)) isinWapMap[isin] = { sumFV: 0, sumFVCP: 0 };
  });

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
      dirty_price: formatPrice(row.dirty_price, 4),
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
    const balanceSql = `SELECT g.deal_number, g.face_value, g.isin_number AS isin FROM gsec g WHERE g.transaction_type = 'Buy'` +
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

    // Same fallback as main table: allocate unlinked sells FIFO per ISIN/portfolio
    // so total balance matches deal-level rows even when sell rows are not linked correctly.
    if (balanceRows.length) {
      const [isinRows] = await db.query(
        `SELECT DISTINCT isin_number FROM gsec WHERE transaction_type = 'Buy'` +
          (portfolio ? ' AND portfolio = ?' : '') +
          (isin ? ' AND isin_number = ?' : '') +
          (valueDate ? ' AND value_date = ?' : '') +
          (maturityDate ? ' AND maturity_date = ?' : '') +
          (asAtDate ? ' AND value_date <= ?' : ''),
        balanceParams
      );
      const uniqueIsinsForAllocation = [...new Set(isinRows.map(r => r.isin_number).filter(Boolean))];
      if (uniqueIsinsForAllocation.length) {
        const ph = uniqueIsinsForAllocation.map(() => '?').join(',');
        let sellAllocSql = `
          SELECT id, portfolio, isin_number AS isin, face_value, TRIM(buy_deal_number) AS buy_deal_number, value_date
          FROM gsec
          WHERE transaction_type = 'Sell' AND isin_number IN (${ph})
        `;
        const sellAllocParams = [...uniqueIsinsForAllocation];
        if (portfolio) { sellAllocSql += ' AND portfolio = ?'; sellAllocParams.push(portfolio); }
        if (asAtDate) { sellAllocSql += ' AND DATE(value_date) <= DATE(?)'; sellAllocParams.push(asAtDate); }
        sellAllocSql += ' ORDER BY DATE(value_date), id';

        const [sellAllocRows] = await db.query(sellAllocSql, sellAllocParams);

        // Need buy lists for FIFO allocation: fetch buy deal meta for these ISINs in this filtered scope.
        const buyDealsByKey = {};
        const buyMetaSql =
          `SELECT id, portfolio, deal_number, isin_number AS isin, face_value, value_date
           FROM gsec
           WHERE transaction_type = 'Buy' AND isin_number IN (${ph})` +
          (portfolio ? ' AND portfolio = ?' : '') +
          (isin ? ' AND isin_number = ?' : '') +
          (valueDate ? ' AND value_date = ?' : '') +
          (maturityDate ? ' AND maturity_date = ?' : '') +
          (asAtDate ? ' AND value_date <= ?' : '') +
          ' ORDER BY DATE(value_date), id';

        const buyMetaParams = [...uniqueIsinsForAllocation];
        if (portfolio) buyMetaParams.push(portfolio);
        if (isin) buyMetaParams.push(isin);
        if (valueDate) buyMetaParams.push(valueDate);
        if (maturityDate) buyMetaParams.push(maturityDate);
        if (asAtDate) buyMetaParams.push(asAtDate);

        const [buyMetaRows] = await db.query(buyMetaSql, buyMetaParams);
        buyMetaRows.forEach(b => {
          const dealNo = (b.deal_number || '').trim();
          if (!dealNo || !b.isin) return;
          const key = `${String(b.portfolio || '').trim()}|${String(b.isin).trim()}`;
          if (!buyDealsByKey[key]) buyDealsByKey[key] = [];
          buyDealsByKey[key].push({
            deal_number: dealNo,
            face_value: Number(b.face_value) || 0,
            value_date: b.value_date,
            id: Number(b.id) || 0
          });
        });

        const buyDealSet = new Set(dealNumbers.map(d => d.trim()));
        for (const s of sellAllocRows) {
          const linkedDeal = (s.buy_deal_number || '').trim();
          if (linkedDeal && buyDealSet.has(linkedDeal)) continue;

          const sellKey = `${String(s.portfolio || '').trim()}|${String(s.isin || '').trim()}`;
          const fifoBuys = buyDealsByKey[sellKey];
          if (!fifoBuys || !fifoBuys.length) continue;

          let remainingToAllocate = Number(s.face_value) || 0;
          if (remainingToAllocate <= 0) continue;

          for (const b of fifoBuys) {
            if (remainingToAllocate <= 0) break;
            const alreadySold = Number(soldByDeal[b.deal_number] || 0);
            const maxSellable = Math.max(0, (Number(b.face_value) || 0) - alreadySold);
            if (maxSellable <= 0) continue;
            const alloc = Math.min(maxSellable, remainingToAllocate);
            soldByDeal[b.deal_number] = alreadySold + alloc;
            remainingToAllocate -= alloc;
          }
        }
      }
    }
    
    // Always calculate buyback deductions (not just for historical dates)
    const buybackByDeal = {};
    if (dealNumbers.length) {
      const bbCutoff = asAtDate || new Date().toISOString().split('T')[0];
      const balanceIsins = [...new Set(balanceRows.map(r => r.isin).filter(Boolean))];
      const placeholders = dealNumbers.map(() => '?').join(',');
      const isinPh = balanceIsins.map(() => '?').join(',');
      let buybackSql = `
        SELECT source_buy_deal_number, leg1_face_value, leg1_isin
        FROM buyback_deals
        WHERE`;
      
      if (hasTransactionTypeColumn) {
        buybackSql += ` leg1_transaction_type = 'Sell' AND`;
      }
      
      buybackSql += ` deal_status = 'Approved'
        AND DATE(approved_at) <= DATE(?)
        AND (source_buy_deal_number IN (${placeholders}) OR (source_buy_deal_number IS NULL AND leg1_isin IN (${isinPh})))
        ORDER BY approved_at ASC
      `;
      const buybackParams = [bbCutoff, ...dealNumbers, ...balanceIsins];
      const [buybackRows] = await db.query(buybackSql, buybackParams);

      // Build ISIN → deal list for FIFO allocation of NULL-source buybacks
      const balBuysByIsin = {};
      balanceRows.forEach(r => {
        const dn = (r.deal_number || '').trim();
        if (!dn || !r.isin) return;
        if (!balBuysByIsin[r.isin]) balBuysByIsin[r.isin] = [];
        balBuysByIsin[r.isin].push({ deal_number: dn, face_value: Number(r.face_value) || 0 });
      });

      buybackRows.forEach(row => {
        const key = (row.source_buy_deal_number || '').trim();
        const amount = Number(row.leg1_face_value) || 0;
        if (key) {
          buybackByDeal[key] = (buybackByDeal[key] || 0) + amount;
        } else if (row.leg1_isin) {
          const candidates = balBuysByIsin[row.leg1_isin];
          if (!candidates) return;
          let remaining = amount;
          for (const c of candidates) {
            if (remaining <= 0) break;
            const alreadyDeducted = Number(buybackByDeal[c.deal_number] || 0);
            const sold = Number(soldByDeal[c.deal_number] || 0);
            const available = Math.max(0, c.face_value - sold - alreadyDeducted);
            if (available <= 0) continue;
            const alloc = Math.min(remaining, available);
            buybackByDeal[c.deal_number] = alreadyDeducted + alloc;
            remaining -= alloc;
          }
        }
      });
    }
    
    let totalBalance = 0;
    balanceRows.forEach(balanceRow => {
      const originalFace = Number(balanceRow.face_value) || 0;
      const normalizedDealNumber = (balanceRow.deal_number || '').trim();
      const soldAgainstThisDeal = Number(soldByDeal[normalizedDealNumber] || 0);
      const buybackDeduction = Number(buybackByDeal[normalizedDealNumber] || 0);
      
      const remainingFaceValue = Math.max(0, originalFace - soldAgainstThisDeal - buybackDeduction);
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
