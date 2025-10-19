const express = require('express');
const router = express.Router();
const sellTransactionReportService = require('../services/sellTransactionReportService');
const reportExporter = require('../utils/reportExporter');

router.get('/', async (req, res) => {
  try {
    const { asAtDate, portfolio, isin, valueDate, maturityDate, format, page = 1, pageSize = 20 } = req.query;

    const { data, total, totalPortfolioBalance } = await sellTransactionReportService.getSellTransactionReport({
      asAtDate, portfolio, isin, valueDate, maturityDate, page, pageSize
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
