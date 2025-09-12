const gsecReportService = require('../services/gsecReportService');
const reportExporter = require('../utils/reportExporter');

// GET /api/reports/gsec
exports.getGsecReport = async (req, res) => {
  try {
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
    
    const { data, total } = await gsecReportService.getGsecReport(reportParams);

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
    res.json(response);
  } catch (err) {
    console.error('GSec Report Error:', err);
    res.status(500).json({ error: 'Failed to generate GSec report' });
  }
};
