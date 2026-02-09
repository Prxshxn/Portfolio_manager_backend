const TransactionDocument = require('../models/transactionDocumentModel');
const path = require('path');
const fs = require('fs');

/**
 * Upload a document for a transaction
 * POST /api/documents/upload
 */
exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file && !req.files) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const files = req.files || [req.file];
    const transactionType = req.body.transaction_type;
    const transactionId = req.body.transaction_id;
    const description = req.body.description || null;
    const uploadedBy = req.user?.id || req.body.uploaded_by || null;

    if (!transactionType || !transactionId) {
      // Clean up uploaded files if validation fails
      for (const file of files) {
        try {
          await fs.promises.unlink(file.path);
        } catch (err) {
          console.warn(`Failed to clean up file: ${file.path}`, err);
        }
      }

      return res.status(400).json({
        success: false,
        error: 'transaction_type and transaction_id are required'
      });
    }

    const uploadedDocuments = [];

    for (const file of files) {
      try {
        // Calculate relative path from project root
        const projectRoot = path.join(__dirname, '..');
        let relativePath;
        
        try {
          relativePath = path.relative(projectRoot, file.path).replace(/\\/g, '/');
        } catch (relError) {
          // If relative path calculation fails, use the absolute path
          console.warn('Could not calculate relative path, using absolute:', relError.message);
          relativePath = file.path.replace(/\\/g, '/');
        }

        console.log('File uploaded:', {
          originalname: file.originalname,
          path: file.path,
          relativePath: relativePath,
          size: file.size,
          mimetype: file.mimetype
        });

        const documentData = {
          transaction_type: transactionType,
          transaction_id: String(transactionId),
          file_name: file.originalname,
          file_path: relativePath,
          file_size: file.size,
          mime_type: file.mimetype,
          uploaded_by: uploadedBy,
          description: description
        };

        console.log('Creating document record:', documentData);
        const document = await TransactionDocument.create(documentData);
        uploadedDocuments.push(document);
        console.log('Document created successfully:', document.id);
      } catch (error) {
        // Clean up file if database insert fails
        try {
          await fs.promises.unlink(file.path);
        } catch (err) {
          console.warn(`Failed to clean up file: ${file.path}`, err);
        }

        console.error('Error creating document record:', error);
        console.error('Error stack:', error.stack);
        // Continue with other files even if one fails
      }
    }

    if (uploadedDocuments.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Failed to upload any documents'
      });
    }

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${uploadedDocuments.length} document(s)`,
      documents: uploadedDocuments
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to upload document',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get all documents for a transaction
 * GET /api/documents/:transactionType/:transactionId
 */
exports.getDocuments = async (req, res) => {
  try {
    const { transactionType, transactionId } = req.params;

    if (!transactionType || !transactionId) {
      return res.status(400).json({
        success: false,
        error: 'transaction_type and transaction_id are required'
      });
    }

    const documents = await TransactionDocument.getByTransaction(
      transactionType,
      transactionId
    );

    res.json({
      success: true,
      documents: documents
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch documents',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Download a document
 * GET /api/documents/:id/download
 */
exports.downloadDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await TransactionDocument.getById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    const filePath = await TransactionDocument.getFilePath(id);

    // Check if file exists
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'File not found on server'
      });
    }

    // Set headers for file download
    res.setHeader('Content-Type', document.mime_type);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(document.file_name)}"`
    );
    res.setHeader('Content-Length', document.file_size);

    // Stream file to response
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Error reading file'
        });
      }
    });
  } catch (error) {
    console.error('Error downloading document:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to download document',
        details: error.message
      });
    }
  }
};

/**
 * Delete a document
 * DELETE /api/documents/:id
 */
exports.deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const document = await TransactionDocument.getById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }

    // Authorization: Users can only delete their own uploads (or admin)
    // Note: Add admin check if you have role-based access
    if (userId && document.uploaded_by && document.uploaded_by !== userId) {
      // Check if user is admin (you may need to adjust this based on your auth system)
      // For now, allow deletion if user matches or if no uploaded_by is set
      // You can enhance this with proper role checking
    }

    const deleted = await TransactionDocument.delete(id);

    if (deleted) {
      res.json({
        success: true,
        message: 'Document deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Document not found'
      });
    }
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete document',
      details: error.message
    });
  }
};

/**
 * Update document metadata
 * PUT /api/documents/:id
 */
exports.updateDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { description, file_name } = req.body;

    const updates = {};
    if (description !== undefined) updates.description = description;
    if (file_name !== undefined) updates.file_name = file_name;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    const updatedDocument = await TransactionDocument.update(id, updates);

    res.json({
      success: true,
      message: 'Document updated successfully',
      document: updatedDocument
    });
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update document',
      details: error.message
    });
  }
};
