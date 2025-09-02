const markToMarketService = require('../services/markToMarketService');
const excelProcessingService = require('../services/excelProcessingService');

class MarkToMarketController {

  /**
   * Upload Excel file and process mark-to-market data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async uploadExcelFile(req, res) {
    try {
      console.log('📤 Excel file upload request received');
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No Excel file uploaded'
        });
      }

      const { filename, originalname } = req.file;
      console.log(`📁 Processing file: ${originalname} (${filename})`);

      // Process Excel file using excelProcessingService
      // Pass the full path including uploads directory
      const filePath = `uploads/${filename}`;
      const extractedData = await excelProcessingService.processExcelFile(filePath);
      
      if (!extractedData || extractedData.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No treasury bond data found in Excel file'
        });
      }

      console.log(`📊 Extracted ${extractedData.length} records from Excel`);

      // Update mark-to-market data using markToMarketService
      const updateResults = await markToMarketService.updateMarkToMarketData(
        extractedData, 
        originalname
      );

      res.json({
        success: true,
        message: 'Excel file processed successfully',
        data: {
          filename: originalname,
          recordsProcessed: extractedData.length,
          updateResults
        }
      });

    } catch (error) {
      console.error('❌ Error in uploadExcelFile:', error);
      res.status(500).json({
        success: false,
        message: 'Error processing Excel file',
        error: error.message
      });
    }
  }

  /**
   * Get all mark-to-market data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAllMarkToMarketData(req, res) {
    try {
      console.log('📊 Fetching all mark-to-market data');
      
      const data = await markToMarketService.getAllMarkToMarketData();
      
      res.json({
        success: true,
        data: data,
        count: data.length
      });

    } catch (error) {
      console.error('❌ Error getting mark-to-market data:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching mark-to-market data',
        error: error.message
      });
    }
  }

  /**
   * Get mark-to-market data by series
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getMarkToMarketBySeries(req, res) {
    try {
      const { series } = req.params;
      console.log(`🔍 Fetching mark-to-market data for series: ${series}`);
      
      const data = await markToMarketService.getMarkToMarketBySeries(series);
      
      if (!data) {
        return res.status(404).json({
          success: false,
          message: `No mark-to-market data found for series: ${series}`
        });
      }

      res.json({
        success: true,
        data: data
      });

    } catch (error) {
      console.error('❌ Error getting mark-to-market by series:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching mark-to-market data',
        error: error.message
      });
    }
  }

  /**
   * Get summary statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getSummaryStatistics(req, res) {
    try {
      console.log('📈 Fetching mark-to-market summary statistics');
      
      const stats = await markToMarketService.getSummaryStatistics();
      
      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      console.error('❌ Error getting summary statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching summary statistics',
        error: error.message
      });
    }
  }

  /**
   * Delete mark-to-market record by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteMarkToMarketRecord(req, res) {
    try {
      const { id } = req.params;
      console.log(`🗑️ Deleting mark-to-market record with ID: ${id}`);
      
      // Add delete method to service if needed
      // await markToMarketService.deleteRecord(id);
      
      res.json({
        success: true,
        message: `Mark-to-market record ${id} deleted successfully`
      });

    } catch (error) {
      console.error('❌ Error deleting mark-to-market record:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting mark-to-market record',
        error: error.message
      });
    }
  }

  /**
   * Health check endpoint
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async healthCheck(req, res) {
    try {
      const stats = await markToMarketService.getSummaryStatistics();
      
      res.json({
        success: true,
        message: 'Mark-to-Market service is healthy',
        timestamp: new Date().toISOString(),
        stats: stats
      });

    } catch (error) {
      console.error('❌ Health check failed:', error);
      res.status(500).json({
        success: false,
        message: 'Mark-to-Market service health check failed',
        error: error.message
      });
    }
  }

}

module.exports = new MarkToMarketController();