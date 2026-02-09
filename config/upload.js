// Upload configuration for different environments

const config = {
  development: {
    storage: 'local',
    uploadPath: './uploads/',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['.xls', '.xlsx'],
    // Document upload configuration
    transactionDocumentsPath: './uploads/transactions/',
    documentMaxFileSize: 20 * 1024 * 1024, // 20MB for documents
    documentAllowedTypes: ['.pdf', '.jpg', '.jpeg', '.png', '.xls', '.xlsx']
  },
  
  production: {
    storage: 'cloud', // AWS S3, Google Cloud, etc.
    uploadPath: process.env.CLOUD_UPLOAD_PATH,
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: ['.xls', '.xlsx'],
    // Document upload configuration
    transactionDocumentsPath: process.env.CLOUD_TRANSACTION_DOCUMENTS_PATH || './uploads/transactions/',
    documentMaxFileSize: 20 * 1024 * 1024, // 20MB for documents
    documentAllowedTypes: ['.pdf', '.jpg', '.jpeg', '.png', '.xls', '.xlsx']
  },
  
  test: {
    storage: 'memory',
    uploadPath: null,
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['.xls', '.xlsx'],
    // Document upload configuration
    transactionDocumentsPath: './uploads/transactions/',
    documentMaxFileSize: 20 * 1024 * 1024, // 20MB for documents
    documentAllowedTypes: ['.pdf', '.jpg', '.jpeg', '.png', '.xls', '.xlsx']
  }
};

module.exports = config[process.env.NODE_ENV || 'development'];
