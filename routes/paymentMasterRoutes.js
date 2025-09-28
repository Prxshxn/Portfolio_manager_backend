const express = require('express');
const router = express.Router();
const paymentMasterController = require('../controllers/paymentMasterController');

// Add debugging middleware
router.use((req, res, next) => {
  console.log(`Payment Master Route: ${req.method} ${req.path}`);
  console.log('Request body:', req.body);
  next();
});

// Temporary test route
router.get('/test', (req, res) => {
  res.json({ message: 'Payment master routes are working!' });
});

/**
 * @swagger
 * /payment-master/bank-payment-codes:
 *   get:
 *     summary: Get all bank payment codes
 *     description: Returns a distinct list of bank payment codes from settlement accounts for use as settlement modes/codes.
 *     tags: [PaymentMaster]
 *     responses:
 *       200:
 *         description: List of bank payment codes
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
 *                     type: string
 *       500:
 *         description: Server error
 */
router.get('/bank-payment-codes', (req, res) => {
  console.log('Accessing bank payment codes route');
  paymentMasterController.getBankPaymentCodes(req, res);
});

/**
 * @swagger
 * /payment-master/bank-details/{code}:
 *   get:
 *     summary: Get bank details by settlement code
 *     description: Looks up settlement bank details (bank name, branch, account number) for a given bank payment code.
 *     tags: [PaymentMaster]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank payment code
 *     responses:
 *       200:
 *         description: Bank details found
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
 *                     bank_name:
 *                       type: string
 *                     bank_branch:
 *                       type: string
 *                     bank_account_number:
 *                       type: string
 *       404:
 *         description: No bank details found for this code
 *       500:
 *         description: Server error
 */
router.get('/bank-details/:code', (req, res) => {
  console.log('Accessing bank details route with code:', req.params.code);
  paymentMasterController.getBankDetailsByPaymentCode(req, res);
});

// POST create new Payment Master record
router.post('/', (req, res) => {
  console.log('Accessing POST payment master route');
  console.log('Request body:', req.body);
  
  // Check if controller exists
  if (!paymentMasterController.createPaymentMaster) {
    console.error('createPaymentMaster method not found in controller');
    return res.status(500).json({ error: 'Controller method not found' });
  }
  
  paymentMasterController.createPaymentMaster(req, res);
});

// GET all Payment Master records
router.get('/', paymentMasterController.getAllPaymentMasters);

// GET search Payment Master records
router.get('/search', paymentMasterController.searchPaymentMasters);

// PUT update Payment Master record by ID
router.put('/:id', paymentMasterController.updatePaymentMaster);

// GET payment methods
router.get('/methods', paymentMasterController.getPaymentMethods);

// GET all payment methods from payment_master (for dropdown)
router.get('/all-methods', paymentMasterController.getAllPaymentMethods);

/**
 * @swagger
 * /payment-master/modes:
 *   get:
 *     summary: Get settlement modes
 *     description: Returns distinct settlement modes combining payment_method and bank_payment_code from payment masters.
 *     tags: [PaymentMaster]
 *     responses:
 *       200:
 *         description: Settlement modes list
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
 *                     type: object
 *                     properties:
 *                       payment_method:
 *                         type: string
 *                       bank_payment_code:
 *                         type: string
 *       500:
 *         description: Server error
 */
router.get('/modes', paymentMasterController.getPaymentModes);

module.exports = router;