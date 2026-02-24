const express = require('express');
const router = express.Router();
const db = require('../config/db');
const markToMarketService = require('../services/markToMarketService');

// GET /api/reports/mark-to-market
router.get('/', async (req, res) => {
  try {
    const { series, isin, maturityDate, format, page = 1, pageSize = 20 } = req.query;

    // Build query with filters - join with GSec to get WAP and Balance data
    let sql = `
      SELECT 
        mtm.series,
        mtm.isin_number as isin,
        mtm.isin_issuer,
        mtm.maturity_date,
        mtm.buying_price,
        mtm.selling_price,
        mtm.average_price,
        mtm.buying_yield,
        mtm.selling_yield,
        mtm.average_yield,
        mtm.last_updated,
        mtm.excel_source,
        g.face_value,
        g.clean_price,
        g.transaction_type
      FROM mark_to_market mtm
      LEFT JOIN gsec g ON mtm.isin_number COLLATE utf8mb4_unicode_ci = g.isin_number COLLATE utf8mb4_unicode_ci
      WHERE 1=1
    `;
    
    const params = [];
    
    if (series) {
      sql += ' AND mtm.series LIKE ?';
      params.push(`%${series}%`);
    }
    if (isin) {
      sql += ' AND mtm.isin_number = ?';
      params.push(isin);
    }
    if (maturityDate) {
      sql += ' AND mtm.maturity_date = ?';
      params.push(maturityDate);
    }

    sql += ' ORDER BY mtm.series, mtm.isin_number';

    // Pagination
    const offset = (page - 1) * pageSize;
    sql += ' LIMIT ? OFFSET ?';
    params.push(Number(pageSize), Number(offset));

    const [rows] = await db.query(sql, params);

    // Calculate WAP and Balance per ISIN
    const isinData = {};
    rows.forEach(row => {
      const isin = row.isin;
      if (!isinData[isin]) {
        isinData[isin] = {
          series: row.series,
          isin: row.isin,
          isin_issuer: row.isin_issuer,
          maturity_date: row.maturity_date,
          buying_price: row.buying_price,
          selling_price: row.selling_price,
          average_price: row.average_price,
          buying_yield: row.buying_yield,
          selling_yield: row.selling_yield,
          average_yield: row.average_yield,
          last_updated: row.last_updated,
          excel_source: row.excel_source,
          balance: 0,
          wap: 0,
          sumFV: 0,
          sumFVCP: 0
        };
      }

      // Calculate balance (buys - sells)
      if (row.transaction_type && row.transaction_type.toLowerCase() === 'sell') {
        isinData[isin].balance -= Number(row.face_value) || 0;
      } else {
        isinData[isin].balance += Number(row.face_value) || 0;
      }

      // Calculate WAP (only for buy transactions)
      if (!row.transaction_type || row.transaction_type.toLowerCase() !== 'sell') {
        const fv = Number(row.face_value) || 0;
        const cp = Number(row.clean_price) || 0;
        isinData[isin].sumFV += fv;
        isinData[isin].sumFVCP += fv * cp;
      }
    });

    // Calculate WAP and Unrealized Gain for each ISIN
    const data = Object.values(isinData).map(item => {
      const wap = item.sumFV > 0 ? item.sumFVCP / item.sumFV : 0;
      const markToMarketPrice = Number(item.average_price) || 0;
      const balance = Number(item.balance) || 0;
      const unrealizedGain = ((markToMarketPrice - wap) * balance) / 100;

      return {
        series: item.series,
        isin: item.isin,
        isin_issuer: item.isin_issuer || '',
        maturity_date: item.maturity_date,
        buying_price: Number(item.buying_price).toFixed(4),
        selling_price: Number(item.selling_price).toFixed(4),
        average_price: Number(item.average_price).toFixed(4),
        buying_yield: Number(item.buying_yield).toFixed(2),
        selling_yield: Number(item.selling_yield).toFixed(2),
        average_yield: Number(item.average_yield).toFixed(2),
        unrealized_gain: unrealizedGain.toFixed(4),
        last_updated: item.last_updated,
        excel_source: item.excel_source || ''
      };
    });

    // Get total count for pagination
    let countSql = 'SELECT COUNT(DISTINCT mtm.isin_number) as count FROM mark_to_market mtm WHERE 1=1';
    const countParams = [];
    
    if (series) {
      countSql += ' AND mtm.series LIKE ?';
      countParams.push(`%${series}%`);
    }
    if (isin) {
      countSql += ' AND mtm.isin_number = ?';
      countParams.push(isin);
    }
    if (maturityDate) {
      countSql += ' AND mtm.maturity_date = ?';
      countParams.push(maturityDate);
    }

    const [[{ count }]] = await db.query(countSql, countParams);

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const reportExporter = require('../utils/reportExporter');
      const fileBuffer = await reportExporter.export(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=mark_to_market_report.${format === 'excel' ? 'xlsx' : format}`);
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
    console.error('Error fetching mark-to-market report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report' });
  }
});

module.exports = router;