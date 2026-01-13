const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const importChartOfAccounts = require('../scripts/importChartOfAccounts');
const importChartOfAccountsNewFormat = require('../scripts/importChartOfAccountsNewFormat');
const db = require('../config/database');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'chart-of-accounts-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || 
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * @swagger
 * /api/chart-of-accounts/import:
 *   post:
 *     summary: Import chart of accounts from CSV file
 *     tags: [Chart of Accounts]
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         required: true
 *         description: CSV file containing chart of accounts
 *       - in: formData
 *         name: deleteExisting
 *         type: boolean
 *         description: Delete all existing accounts before import
 *       - in: formData
 *         name: updateExisting
 *         type: boolean
 *         description: Update existing accounts (default: true)
 *     responses:
 *       200:
 *         description: Import completed successfully
 *       400:
 *         description: Invalid file or missing file
 *       500:
 *         description: Import failed
 */
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No CSV file uploaded'
      });
    }

    const options = {
      deleteExisting: req.body.deleteExisting === 'true',
      updateExisting: req.body.updateExisting !== 'false', // Default to true
      dryRun: false,
      useNewFormat: req.body.useNewFormat === 'true' // New format with Primary/Sub codes
    };

    console.log('📤 Chart of Accounts import request received');
    console.log(`📁 File: ${req.file.originalname}`);
    console.log(`📊 Options:`, options);

    // Use new format if specified, otherwise try to auto-detect
    let result;
    if (options.useNewFormat) {
      result = await importChartOfAccountsNewFormat(req.file.path, options);
    } else {
      // Try new format first, fallback to old format
      try {
        result = await importChartOfAccountsNewFormat(req.file.path, options);
      } catch (err) {
        console.log('New format failed, trying old format...');
        result = await importChartOfAccounts(req.file.path, options);
      }
    }

    // Clean up uploaded file
    try {
      fs.unlinkSync(req.file.path);
    } catch (err) {
      console.warn('Could not delete uploaded file:', err);
    }

    res.json({
      success: true,
      message: 'Chart of accounts imported successfully',
      data: result
    });
  } catch (error) {
    console.error('Error importing chart of accounts:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.warn('Could not delete uploaded file:', err);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to import chart of accounts'
    });
  }
});

/**
 * @swagger
 * /api/chart-of-accounts/export:
 *   get:
 *     summary: Export chart of accounts to CSV
 *     tags: [Chart of Accounts]
 *     responses:
 *       200:
 *         description: CSV file download
 */
router.get('/export', async (req, res) => {
  try {
    const [accounts] = await db.query(`
      SELECT 
        coa.account_code,
        coa.name,
        coa.is_active,
        coa.category,
        coa.type,
        at.name as account_type_name
      FROM chart_of_accounts coa
      LEFT JOIN account_types at ON coa.account_type_id = at.id
      ORDER BY coa.account_code
    `);

    // Generate CSV
    let csv = 'Account Code,Description,Active Status,Category,Type,Account Type\n';
    accounts.forEach(account => {
      const code = account.account_code || '';
      const name = (account.name || '').replace(/,/g, ';'); // Replace commas in names
      const active = account.is_active ? 'Yes' : 'No';
      const category = account.category || '';
      const type = account.type || '';
      const accountType = account.account_type_name || '';
      csv += `${code},${name},${active},${category},${type},${accountType}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=chart-of-accounts-export.csv');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting chart of accounts:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to export chart of accounts'
    });
  }
});

module.exports = router;
