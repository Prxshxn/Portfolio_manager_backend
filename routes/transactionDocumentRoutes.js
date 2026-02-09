const express = require('express');
const router = express.Router();
const transactionDocumentController = require('../controllers/transactionDocumentController');
const { uploadSingle, uploadMultiple } = require('../middleware/documentUpload');
// const auth = require('../middlewares/auth'); // Uncomment if you have auth middleware

/**
 * @swagger
 * /api/documents/upload:
 *   post:
 *     summary: Upload a document for a transaction
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - transaction_type
 *               - transaction_id
 *               - document
 *             properties:
 *               transaction_type:
 *                 type: string
 *                 example: "gsec"
 *               transaction_id:
 *                 type: string
 *                 example: "123"
 *               document:
 *                 type: string
 *                 format: binary
 *               description:
 *                 type: string
 *                 example: "Supporting document"
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.post(
  '/upload',
  (req, res, next) => {
    uploadSingle('document')(req, res, (err) => {
      if (err) {
        console.error('Multer upload error:', err);
        return res.status(400).json({
          success: false,
          error: err.message || 'File upload error'
        });
      }
      next();
    });
  },
  transactionDocumentController.uploadDocument
);

/**
 * @swagger
 * /api/documents/upload-multiple:
 *   post:
 *     summary: Upload multiple documents for a transaction
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - transaction_type
 *               - transaction_id
 *               - documents
 *             properties:
 *               transaction_type:
 *                 type: string
 *                 example: "gsec"
 *               transaction_id:
 *                 type: string
 *                 example: "123"
 *               documents:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               description:
 *                 type: string
 *                 example: "Supporting documents"
 *     responses:
 *       201:
 *         description: Documents uploaded successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.post(
  '/upload-multiple',
  (req, res, next) => {
    uploadMultiple('documents', 10)(req, res, (err) => {
      if (err) {
        console.error('Multer upload error:', err);
        return res.status(400).json({
          success: false,
          error: err.message || 'File upload error'
        });
      }
      next();
    });
  },
  transactionDocumentController.uploadDocument
);

/**
 * @swagger
 * /api/documents/{transactionType}/{transactionId}:
 *   get:
 *     summary: Get all documents for a transaction
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: transactionType
 *         required: true
 *         schema:
 *           type: string
 *         example: "gsec"
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: "123"
 *     responses:
 *       200:
 *         description: List of documents
 *       400:
 *         description: Bad request
 *       500:
 *         description: Server error
 */
router.get(
  '/:transactionType/:transactionId',
  transactionDocumentController.getDocuments
);

/**
 * @swagger
 * /api/documents/{id}/download:
 *   get:
 *     summary: Download a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *     responses:
 *       200:
 *         description: File download
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get(
  '/:id/download',
  transactionDocumentController.downloadDocument
);

/**
 * @swagger
 * /api/documents/{id}:
 *   put:
 *     summary: Update document metadata
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               file_name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document updated successfully
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.put(
  '/:id',
  transactionDocumentController.updateDocument
);

/**
 * @swagger
 * /api/documents/{id}:
 *   delete:
 *     summary: Delete a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.delete(
  '/:id',
  transactionDocumentController.deleteDocument
);

module.exports = router;
