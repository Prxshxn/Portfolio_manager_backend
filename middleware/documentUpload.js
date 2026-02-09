const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const uploadConfig = require('../config/upload');

/**
 * Create multer storage configuration for transaction documents
 * Files are stored in: uploads/transactions/{transactionType}/{transactionId}/
 */
const createStorage = () => {
  return multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const transactionType = req.body.transaction_type || req.params.transactionType || 'transaction';
        const transactionId = req.body.transaction_id || req.params.transactionId || 'temp';
        
        // Get upload path, with fallback
        const basePath = uploadConfig.transactionDocumentsPath || './uploads/transactions/';
        
        // Create directory structure
        const uploadDir = path.join(
          __dirname,
          '..',
          basePath,
          transactionType,
          String(transactionId)
        );

        // Ensure directory exists
        await fs.mkdir(uploadDir, { recursive: true });
        console.log('Upload directory created:', uploadDir);
        
        cb(null, uploadDir);
      } catch (error) {
        console.error('Error creating upload directory:', error);
        cb(error, null);
      }
    },
    filename: (req, file, cb) => {
      // Generate unique filename: {timestamp}-{random}-{originalname}
      const timestamp = Date.now();
      const random = Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      // Sanitize filename to prevent path traversal
      const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const uniqueFilename = `${timestamp}-${random}-${sanitizedBaseName}${ext}`;
      cb(null, uniqueFilename);
    }
  });
};

/**
 * File filter to only allow PDF, Images, and Excel files
 */
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    // PDF
    'application/pdf',
    // Images
    'image/jpeg',
    'image/jpg',
    'image/png',
    // Excel
    'application/vnd.ms-excel', // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/octet-stream' // Some systems send this for .xls
  ];

  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.xls', '.xlsx'];
  const fileExtension = path.extname(file.originalname).toLowerCase();

  // Check both MIME type and file extension
  if (
    allowedMimeTypes.includes(file.mimetype) ||
    allowedExtensions.includes(fileExtension)
  ) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type. Only PDF, Images (JPG, PNG), and Excel files (.xls, .xlsx) are allowed. Received: ${file.mimetype}`
      ),
      false
    );
  }
};

/**
 * Configure multer for document uploads
 */
const documentUpload = multer({
  storage: createStorage(),
  fileFilter: fileFilter,
  limits: {
    fileSize: uploadConfig.documentMaxFileSize, // 20MB
    files: 10 // Allow up to 10 files per request
  }
});

/**
 * Middleware to handle single file upload
 */
const uploadSingle = (fieldName = 'document') => {
  return documentUpload.single(fieldName);
};

/**
 * Middleware to handle multiple file uploads
 */
const uploadMultiple = (fieldName = 'documents', maxCount = 10) => {
  return documentUpload.array(fieldName, maxCount);
};

/**
 * Middleware to handle multiple fields with files
 */
const uploadFields = (fields) => {
  return documentUpload.fields(fields);
};

module.exports = {
  documentUpload,
  uploadSingle,
  uploadMultiple,
  uploadFields,
  fileFilter
};
