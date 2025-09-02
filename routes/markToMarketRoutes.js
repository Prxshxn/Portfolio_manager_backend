const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const markToMarketController = require('../controllers/markToMarketController');
const auth = require('../middlewares/auth');

// Configure multer for Excel file uploads
const uploadConfig = require('../config/upload');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Use environment-specific upload path
    cb(null, uploadConfig.uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to only allow Excel files
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/octet-stream' // Some systems send this for .xls
  ];
  
  const allowedExtensions = ['.xls', '.xlsx'];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files (.xls, .xlsx) are allowed'), false);
  }
};

// Configure multer with file size limits
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: uploadConfig.maxFileSize, // Environment-specific file size limit
    files: 1 // Only allow 1 file per request
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     MarkToMarketRecord:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique identifier
 *         series:
 *           type: string
 *           description: Series identifier (e.g., "10.35%2025A")
 *         isin_number:
 *           type: string
 *           description: ISIN number
 *         isin_issuer:
 *           type: string
 *           description: ISIN issuer name
 *         maturity_date:
 *           type: string
 *           format: date
 *           description: Maturity date
 *         buying_price:
 *           type: number
 *           format: float
 *           description: Buying price
 *         selling_price:
 *           type: number
 *           format: float
 *           description: Selling price
 *         average_price:
 *           type: number
 *           format: float
 *           description: Average of buying and selling prices
 *         buying_yield:
 *           type: number
 *           format: float
 *           description: Buying yield
 *         selling_yield:
 *           type: number
 *           format: float
 *           description: Selling yield
 *         average_yield:
 *           type: number
 *           format: float
 *           description: Average of buying and selling yields
 *         dirty_price:
 *           type: number
 *           format: float
 *           description: Calculated dirty price
 *         last_updated:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *         excel_source:
 *           type: string
 *           description: Source Excel filename
 * 
 *     ExcelUploadResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Operation success status
 *         message:
 *           type: string
 *           description: Response message
 *         data:
 *           type: object
 *           properties:
 *             filename:
 *               type: string
 *               description: Original filename
 *             recordsProcessed:
 *               type: integer
 *               description: Number of records processed
 *             updateResults:
 *               type: object
 *               properties:
 *                 successCount:
 *                   type: integer
 *                   description: Number of successful updates
 *                 errorCount:
 *                   type: integer
 *                   description: Number of errors
 *                 skippedCount:
 *                   type: integer
 *                   description: Number of skipped records
 */

/**
 * @swagger
 * tags:
 *   name: Mark-to-Market
 *   description: Mark-to-Market data management endpoints
 */

/**
 * @swagger
 * /api/mark-to-market/upload:
 *   post:
 *     summary: Upload Excel file and process mark-to-market data
 *     tags: [Mark-to-Market]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               excelFile:
 *                 type: string
 *                 format: binary
 *                 description: Excel file (.xls or .xlsx) containing treasury bond data
 *     responses:
 *       200:
 *         description: Excel file processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExcelUploadResponse'
 *       400:
 *         description: Bad request - Invalid file or no data found
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/upload', auth, upload.single('excelFile'), markToMarketController.uploadExcelFile);

/**
 * @swagger
 * /api/mark-to-market/data:
 *   get:
 *     summary: Get all mark-to-market data
 *     tags: [Mark-to-Market]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mark-to-market data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MarkToMarketRecord'
 *                 count:
 *                   type: integer
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/data', auth, markToMarketController.getAllMarkToMarketData);

/**
 * @swagger
 * /api/mark-to-market/series/{series}:
 *   get:
 *     summary: Get mark-to-market data for a specific series
 *     tags: [Mark-to-Market]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: series
 *         required: true
 *         schema:
 *           type: string
 *         description: Series identifier (e.g., "10.35%2025A")
 *     responses:
 *       200:
 *         description: Series data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/MarkToMarketRecord'
 *       404:
 *         description: Series not found
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/series/:series', auth, markToMarketController.getMarkToMarketBySeries);

/**
 * @swagger
 * /api/mark-to-market/statistics:
 *   get:
 *     summary: Get mark-to-market summary statistics
 *     tags: [Mark-to-Market]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_records:
 *                       type: integer
 *                       description: Total number of records
 *                     unique_series:
 *                       type: integer
 *                       description: Number of unique series
 *                     avg_yield:
 *                       type: number
 *                       format: float
 *                       description: Average yield across all records
 *                     avg_price:
 *                       type: number
 *                       format: float
 *                       description: Average price across all records
 *                     last_update:
 *                       type: string
 *                       format: date-time
 *                       description: Last update timestamp
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.get('/statistics', auth, markToMarketController.getSummaryStatistics);

/**
 * @swagger
 * /api/mark-to-market/health:
 *   get:
 *     summary: Health check for mark-to-market service
 *     tags: [Mark-to-Market]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 stats:
 *                   type: object
 *                   description: Current statistics
 *       500:
 *         description: Service health check failed
 */
router.get('/health', markToMarketController.healthCheck);

/**
 * @swagger
 * /api/mark-to-market/record/{id}:
 *   delete:
 *     summary: Delete a mark-to-market record
 *     tags: [Mark-to-Market]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Record ID to delete
 *     responses:
 *       200:
 *         description: Record deleted successfully
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.delete('/record/:id', auth, markToMarketController.deleteMarkToMarketRecord);

module.exports = router;
