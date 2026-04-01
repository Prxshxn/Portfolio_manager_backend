const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/reports/mark-to-market
router.get('/', async (req, res) => {
  try {
    const { series, isin, maturityDate, format, page = 1, pageSize = 20 } = req.query;

    // Fetch ALL joined rows (no LIMIT) so aggregation by ISIN is complete
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

    const [rows] = await db.query(sql, params);

    // Aggregate by ISIN to calculate WAP and Balance
    const isinData = {};
    rows.forEach(row => {
      const key = row.isin;
      if (!isinData[key]) {
        isinData[key] = {
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
          sumFV: 0,
          sumFVCP: 0
        };
      }

      if (row.transaction_type && row.transaction_type.toLowerCase() === 'sell') {
        isinData[key].balance -= Number(row.face_value) || 0;
      } else {
        isinData[key].balance += Number(row.face_value) || 0;
      }

      if (!row.transaction_type || row.transaction_type.toLowerCase() !== 'sell') {
        const fv = Number(row.face_value) || 0;
        const cp = Number(row.clean_price) || 0;
        isinData[key].sumFV += fv;
        isinData[key].sumFVCP += fv * cp;
      }
    });

    // Build final aggregated data (one row per ISIN)
    const allData = Object.values(isinData).map(item => {
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

    // Handle export formats – export ALL aggregated data (no pagination)
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const reportExporter = require('../utils/reportExporter');
      const fileBuffer = await reportExporter.exportMarkToMarket(format, allData);
      res.setHeader('Content-Disposition', `attachment; filename=mark_to_market_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Paginate the aggregated data for JSON response
    const total = allData.length;
    const pg = Number(page);
    const ps = Number(pageSize);
    const offset = (pg - 1) * ps;
    const pagedData = allData.slice(offset, offset + ps);

    res.json({
      success: true,
      data: pagedData,
      total,
      page: pg,
      pageSize: ps
    });
  } catch (error) {
    console.error('Error fetching mark-to-market report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report' });
  }
});

module.exports = router;