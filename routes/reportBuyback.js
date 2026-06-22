const express = require('express');
const router = express.Router();
const buybackReportService = require('../services/buybackReportService');

// GET /api/reports/buyback
router.get('/', async (req, res) => {
  try {
    const { asAtDate, portfolio, isin, valueDate, maturityDate, transactionPair, format, page = 1, pageSize = 20 } = req.query;
    const pageNumber = Number(page);
    const pageSizeNumber = Number(pageSize);

    const result = await buybackReportService.getBuybackReport({
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      transactionPair,
      // Downloads should not be truncated by pagination defaults.
      page: format ? undefined : pageNumber,
      pageSize: format ? undefined : pageSizeNumber
    });

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const reportExporter = require('../utils/reportExporter');
      const fileBuffer = await reportExporter.exportBuyback(format, result.data);
      res.setHeader('Content-Disposition', `attachment; filename=buyback_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return paginated JSON
    res.json({ 
      success: true, 
      data: result.data, 
      total: result.total, 
      page: pageNumber, 
      pageSize: pageSizeNumber,
      totalPortfolioBalance: result.totalPortfolioBalance
    });
  } catch (error) {
    console.error('Error fetching buyback report:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch report' });
  }
});

module.exports = router;
