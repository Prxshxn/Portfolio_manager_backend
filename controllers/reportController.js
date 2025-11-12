const gsecReportService = require('../services/gsecReportService');
const portfolioReportService = require('../services/portfolioReportService');
const reportExporter = require('../utils/reportExporter');

// GET /api/reports/gsec
exports.getGsecReport = async (req, res) => {
  try {
    console.log('=== GSEC REPORT API CALLED ===');
    console.log('Query params:', req.query);
    
    const {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      format,
      page,
      pageSize
    } = req.query;

    // Validate required params
    if (!asAtDate && !isin) {
      return res.status(400).json({ error: 'Either asAtDate or ISIN is required' });
    }

    // Fetch report data
    const reportParams = {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate
    };
    
    // Only add pagination if provided (for regular display)
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }
    
    const { data, total, totalPortfolioBalance } = await gsecReportService.getGsecReport(reportParams);

    console.log('GSEC Report Service returned:');
    console.log('Data length:', data.length);
    console.log('First few face values:');
    data.slice(0, 2).forEach(row => {
      console.log(`- ${row.deal_number}: face_value=${row.face_value}`);
    });

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.export(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=gsec_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return JSON (paginated if page/pageSize provided, otherwise all data)
    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    if (totalPortfolioBalance !== null) {
      response.totalPortfolioBalance = totalPortfolioBalance;
    }
    res.json(response);
  } catch (err) {
    console.error('GSec Report Error:', err);
    res.status(500).json({ error: 'Failed to generate GSec report' });
  }
};

// GET /api/reports/portfolio
exports.getPortfolioReport = async (req, res) => {
  try {
    console.log('=== PORTFOLIO REPORT API CALLED ===');
    console.log('Query params:', req.query);
    
    const {
      startDate,
      endDate,
      product,
      portfolio,
      format,
      page,
      pageSize
    } = req.query;

    // Validate required params
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    // Fetch report data
    const reportParams = {
      startDate,
      endDate,
      product,
      portfolio
    };
    
    // Only add pagination if provided (for regular display)
    if (page && pageSize) {
      reportParams.page = Number(page);
      reportParams.pageSize = Number(pageSize);
    }
    
    const { data, total } = await portfolioReportService.getPortfolioReport(reportParams);

    console.log('Portfolio Report Service returned:');
    console.log('Data length:', data.length);
    console.log('Total:', total);

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.export(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=portfolio_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return JSON (paginated if page/pageSize provided, otherwise all data)
    const response = { data, total };
    if (page && pageSize) {
      response.page = Number(page);
      response.pageSize = Number(pageSize);
    }
    res.json(response);
  } catch (err) {
    console.error('Portfolio Report Error:', err);
    res.status(500).json({ error: 'Failed to generate Portfolio report', details: err.message });
  }
};
