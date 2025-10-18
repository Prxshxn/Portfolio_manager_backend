const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/reports/money-market
router.get('/', async (req, res) => {
  try {
    const { asAtDate, portfolio, isin, valueDate, maturityDate, format, page = 1, pageSize = 20 } = req.query;

    // Build query with filters similar to GSec report - only include GSEC deals
    let sql = `
      SELECT 
        g.portfolio,
        g.custodian,
        g.deal_number,
        g.face_value,
        g.value_date,
        g.maturity_date,
        g.isin,
        g.coupon_interest,
        g.clean_price,
        g.yield,
        g.counterparty,
        g.transaction_type,
        mtm.average_price as mark_to_market_price
      FROM gsec g
      LEFT JOIN mark_to_market mtm ON g.isin = mtm.isin_number
      WHERE 1=1
    `;
    
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

    sql += ' ORDER BY g.isin, g.maturity_date';

    // Pagination
    const offset = (page - 1) * pageSize;
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const [rows] = await db.query(sql, params);

    // Calculate balance and WAP per ISIN (similar to GSec report)
    const isinBalances = {};
    const isinWapMap = {};
    
    rows.forEach(row => {
      const isin = row.isin;
      if (!isinBalances[isin]) isinBalances[isin] = 0;
      if (row.transaction_type && row.transaction_type.toLowerCase() === 'sell') {
        isinBalances[isin] -= Number(row.face_value);
      } else {
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

    // Format results with P&L calculation
    const data = rows.map(row => {
      const balance = Number(isinBalances[row.isin]) || 0;
      const wap = (() => {
        const wapData = isinWapMap[row.isin];
        if (wapData && wapData.sumFV) {
          return (wapData.sumFVCP / wapData.sumFV);
        }
        return 0;
      })();
      
      const markToMarketPrice = Number(row.mark_to_market_price) || 0;
      const pnl = ((markToMarketPrice - wap) * balance) / 100;

      return {
        portfolio: row.portfolio,
        custodian: row.custodian || '',
        deal_number: row.deal_number || '',
        face_value: row.face_value !== undefined ? Number(row.face_value).toFixed(2) : '',
        value_date: row.value_date,
        maturity_date: row.maturity_date,
        isin: row.isin,
        coupon_interest: Number(row.coupon_interest).toFixed(4),
        clean_price: Number(row.clean_price).toFixed(4),
        yield: Number(row.yield).toFixed(4),
        balance: balance.toFixed(4),
        pnl: pnl.toFixed(4), // P&L instead of WAP
        counterparty: row.counterparty
      };
    });

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as count FROM gsec g WHERE 1=1';
    const countParams = [];
    
    if (portfolio) {
      countSql += ' AND g.portfolio = ?';
      countParams.push(portfolio);
    }
    if (isin) {
      countSql += ' AND g.isin = ?';
      countParams.push(isin);
    }
    if (valueDate) {
      countSql += ' AND g.value_date = ?';
      countParams.push(valueDate);
    }
    if (maturityDate) {
      countSql += ' AND g.maturity_date = ?';
      countParams.push(maturityDate);
    }

    const [[{ count }]] = await db.query(countSql, countParams);

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const reportExporter = require('../utils/reportExporter');
      const fileBuffer = await reportExporter.export(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=money_market_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return paginated JSON
    res.json({ 
      success: true, 
      data, 
      total: count, 
      page: Number(page), 
      pageSize: Number(pageSize) 
    });
  } catch (error) {
    console.error('Error fetching money market report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report' });
  }
});

module.exports = router;
