const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/reports/mark-to-market
router.get('/', async (req, res) => {
  try {
    const { series, isin, maturityDate, format, page = 1, pageSize = 20 } = req.query;

    // Build query with filters
    let sql = `
      SELECT 
        series,
        isin_number as isin,
        isin_issuer,
        maturity_date,
        buying_price,
        selling_price,
        average_price,
        buying_yield,
        selling_yield,
        average_yield,
        dirty_price,
        last_updated,
        excel_source
      FROM mark_to_market
      WHERE 1=1
    `;
    
    const params = [];
    
    if (series) {
      sql += ' AND series LIKE ?';
      params.push(`%${series}%`);
    }
    if (isin) {
      sql += ' AND isin_number = ?';
      params.push(isin);
    }
    if (maturityDate) {
      sql += ' AND maturity_date = ?';
      params.push(maturityDate);
    }

    sql += ' ORDER BY series, isin_number';

    // Pagination
    const offset = (page - 1) * pageSize;
    sql += ' LIMIT ? OFFSET ?';
    params.push(Number(pageSize), Number(offset));

    const [rows] = await db.query(sql, params);

    // Format results
    const data = rows.map(row => ({
      series: row.series,
      isin: row.isin,
      isin_issuer: row.isin_issuer || '',
      maturity_date: row.maturity_date,
      buying_price: Number(row.buying_price).toFixed(4),
      selling_price: Number(row.selling_price).toFixed(4),
      average_price: Number(row.average_price).toFixed(4),
      buying_yield: Number(row.buying_yield).toFixed(2),
      selling_yield: Number(row.selling_yield).toFixed(2),
      average_yield: Number(row.average_yield).toFixed(2),
      dirty_price: Number(row.dirty_price).toFixed(4),
      last_updated: row.last_updated,
      excel_source: row.excel_source || ''
    }));

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as count FROM mark_to_market WHERE 1=1';
    const countParams = [];
    
    if (series) {
      countSql += ' AND series LIKE ?';
      countParams.push(`%${series}%`);
    }
    if (isin) {
      countSql += ' AND isin_number = ?';
      countParams.push(isin);
    }
    if (maturityDate) {
      countSql += ' AND maturity_date = ?';
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
