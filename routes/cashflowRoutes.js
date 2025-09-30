const express = require('express');
const router = express.Router();
const CashflowController = require('../controllers/cashflowController');
const { checkAuth } = require('../middleware/auth');

/**
 * @swagger
 * components:
 *   schemas:
 *     CashflowStatement:
 *       type: object
 *       properties:
 *         operating:
 *           type: object
 *           properties:
 *             categories:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   inflow:
 *                     type: number
 *                   outflow:
 *                     type: number
 *                   net:
 *                     type: number
 *             total:
 *               type: object
 *               properties:
 *                 inflow:
 *                   type: number
 *                 outflow:
 *                   type: number
 *                 net:
 *                   type: number
 *         investing:
 *           type: object
 *           properties:
 *             categories:
 *               type: array
 *             total:
 *               type: object
 *         financing:
 *           type: object
 *           properties:
 *             categories:
 *               type: array
 *             total:
 *               type: object
 *         netCashflow:
 *           type: number
 *     CashflowTransaction:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         category_id:
 *           type: integer
 *         transaction_date:
 *           type: string
 *           format: date
 *         amount:
 *           type: number
 *         flow_type:
 *           type: string
 *           enum: [inflow, outflow]
 *         currency:
 *           type: string
 *         description:
 *           type: string
 *         reference_number:
 *           type: string
 *         counterparty:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, confirmed, reconciled]
 */

/**
 * @swagger
 * /api/cashflow/statement:
 *   get:
 *     summary: Get cashflow statement
 *     tags: [Cashflow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for cashflow statement
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for cashflow statement
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Currency code (default LKR)
 *     responses:
 *       200:
 *         description: Cashflow statement retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/CashflowStatement'
 *       500:
 *         description: Internal server error
 */
router.get('/statement', checkAuth, CashflowController.getCashflowStatement);

/**
 * @swagger
 * /api/cashflow/projections:
 *   get:
 *     summary: Get cashflow projections
 *     tags: [Cashflow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for projections
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for projections
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *         description: Number of days to project (default 30)
 *     responses:
 *       200:
 *         description: Cashflow projections retrieved successfully
 *       500:
 *         description: Internal server error
 */
router.get('/projections', checkAuth, CashflowController.getCashflowProjections);

/**
 * @swagger
 * /api/cashflow/transactions:
 *   get:
 *     summary: Get cashflow transactions
 *     tags: [Cashflow]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: integer
 *         description: Category ID filter
 *       - in: query
 *         name: flowType
 *         schema:
 *           type: string
 *           enum: [inflow, outflow]
 *         description: Flow type filter
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, reconciled]
 *         description: Status filter
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of records to return (default 100)
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of records to skip (default 0)
 *     responses:
 *       200:
 *         description: Cashflow transactions retrieved successfully
 *       500:
 *         description: Internal server error
 */
router.get('/transactions', checkAuth, CashflowController.getCashflowTransactions);

/**
 * @swagger
 * /api/cashflow/transactions:
 *   post:
 *     summary: Create cashflow transaction
 *     tags: [Cashflow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - category_id
 *               - transaction_date
 *               - amount
 *               - flow_type
 *             properties:
 *               category_id:
 *                 type: integer
 *               transaction_date:
 *                 type: string
 *                 format: date
 *               amount:
 *                 type: number
 *               flow_type:
 *                 type: string
 *                 enum: [inflow, outflow]
 *               currency:
 *                 type: string
 *               description:
 *                 type: string
 *               reference_number:
 *                 type: string
 *               counterparty:
 *                 type: string
 *     responses:
 *       201:
 *         description: Cashflow transaction created successfully
 *       400:
 *         description: Bad request - missing required fields
 *       500:
 *         description: Internal server error
 */
router.post('/transactions', checkAuth, CashflowController.createCashflowTransaction);

/**
 * @swagger
 * /api/cashflow/auto-categorize:
 *   post:
 *     summary: Auto-categorize existing transactions
 *     tags: [Cashflow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Auto-categorization completed successfully
 *       500:
 *         description: Internal server error
 */
router.post('/auto-categorize', checkAuth, CashflowController.autoCategorizeTransactions);

/**
 * @swagger
 * /api/cashflow/categories:
 *   get:
 *     summary: Get cashflow categories
 *     tags: [Cashflow]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cashflow categories retrieved successfully
 *       500:
 *         description: Internal server error
 */
router.get('/categories', checkAuth, CashflowController.getCashflowCategories);

/**
 * @swagger
 * /api/cashflow/reconcile:
 *   post:
 *     summary: Reconcile cashflow
 *     tags: [Cashflow]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reconciliation_date
 *               - opening_balance
 *               - closing_balance
 *             properties:
 *               reconciliation_date:
 *                 type: string
 *                 format: date
 *               opening_balance:
 *                 type: number
 *               closing_balance:
 *                 type: number
 *               total_inflow:
 *                 type: number
 *               total_outflow:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Cashflow reconciliation completed successfully
 *       400:
 *         description: Bad request - missing required fields
 *       500:
 *         description: Internal server error
 */
router.post('/reconcile', checkAuth, CashflowController.reconcileCashflow);

module.exports = router;
