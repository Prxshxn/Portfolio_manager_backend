const express = require('express');
const router = express.Router();
const sellTransactionReportService = require('../services/sellTransactionReportService');
const reportExporter = require('../utils/reportExporter');

router.get('/', async (req, res) => {
  try {
    const { asAtDate, portfolio, isin, valueDate, maturityDate, format, page = 1, pageSize = 20 } = req.query;
    // Convert page and pageSize to numbers to fix SQL LIMIT clause issue
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;

    const { data, total, totalPortfolioBalance } = await sellTransactionReportService.getSellTransactionReport({
      asAtDate, portfolio, isin, valueDate, maturityDate, page: pageNum, pageSize: pageSizeNum
    });

    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.export(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=sell_transaction_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    res.json({
      success: true,
      data,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPortfolioBalance
    });

  } catch (error) {
    console.error('Error fetching sell transaction report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sell transaction report' });
  }
});

module.exports = router;
