const express = require('express');
const router = express.Router();
const MaturityController = require('../controllers/maturityController');

/**
 * @swagger
 * /maturity/money-market:
 *   get:
 *     summary: Get money market maturities
 *     description: Retrieves money market deals maturing up to a specific date
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Maturity date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Money market maturities retrieved successfully
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
 *                       id:
 *                         type: integer
 *                       deal_number:
 *                         type: string
 *                       principal_amount:
 *                         type: number
 *                       maturity_date:
 *                         type: string
 *                         format: date
 *                       counterparty_name:
 *                         type: string
 */
router.get('/money-market', MaturityController.getMoneyMarketMaturities);

/**
 * @swagger
 * /maturity/fixed-income-gsec:
 *   get:
 *     summary: Get GSEC maturities
 *     description: Retrieves GSEC deals maturing up to a specific date
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Maturity date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: GSEC maturities retrieved successfully
 */
router.get('/fixed-income-gsec', MaturityController.getFixedIncomeGsecMaturities);

/**
 * @swagger
 * /maturity/summary:
 *   get:
 *     summary: Get maturity summary
 *     description: Retrieves summary statistics for maturity deals
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Maturity date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Maturity summary retrieved successfully
 */
router.get('/summary', MaturityController.getMaturitySummary);

/**
 * @swagger
 * /maturity/handling:
 *   get:
 *     summary: Get maturity deals for processing
 *     description: Retrieves all deals maturing on or before the specified date for processing
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Maturity date (YYYY-MM-DD)
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum: [all, gsec, money_market, repo, buyback]
 *         description: Deal type filter
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [all, pending, processed, failed]
 *         description: Status filter
 *     responses:
 *       200:
 *         description: Maturity deals retrieved successfully
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
 *                       id:
 *                         type: string
 *                       deal_number:
 *                         type: string
 *                       deal_type:
 *                         type: string
 *                         enum: [money_market, gsec, repo, buyback]
 *                       isin:
 *                         type: string
 *                       counterparty:
 *                         type: string
 *                       face_value:
 *                         type: number
 *                       maturity_date:
 *                         type: string
 *                         format: date
 *                       days_to_maturity:
 *                         type: integer
 *                       status:
 *                         type: string
 *                         enum: [pending, processed, failed]
 */
router.get('/handling', MaturityController.getMaturityHandling);
router.get('/deal-ticket/:productType/:id', MaturityController.getDealTicket);

/**
 * @swagger
 * /maturity/process:
 *   post:
 *     summary: Process maturity deals
 *     description: Processes selected maturity deals with the specified maturity action
 *     tags: [Maturity]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dealIds
 *               - processDate
 *               - maturityAction
 *             properties:
 *               dealIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Array of deal IDs to process
 *               processDate:
 *                 type: string
 *                 format: date
 *                 description: Processing date (YYYY-MM-DD)
 *               bankAccountId:
 *                 type: integer
 *                 description: Bank account ID (required for methods 1 & 2)
 *               maturityAction:
 *                 type: string
 *                 enum: [principal_interest_full_payment, principal_reinvest_interest_paid, principal_interest_reinvest, different_amount_reinvest]
 *                 description: Maturity processing method
 *     responses:
 *       200:
 *         description: Maturity deals processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       dealId:
 *                         type: integer
 *                       dealNumber:
 *                         type: string
 *                       principalAmount:
 *                         type: number
 *                       interestAmount:
 *                         type: number
 *                       totalAmount:
 *                         type: number
 *       403:
 *         description: Authorization required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 requiresAuthorization:
 *                   type: boolean
 *                   example: true
 *                 authorizationLevel:
 *                   type: string
 *                   example: level2
 */
router.post('/process', MaturityController.processMaturities);

/**
 * @swagger
 * /maturity/export:
 *   get:
 *     summary: Export maturity data
 *     description: Exports maturity data to Excel, CSV, or PDF format
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Maturity date (YYYY-MM-DD)
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           enum: [all, gsec, money_market, repo, buyback]
 *         description: Deal type filter
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [all, pending, processed, failed]
 *         description: Status filter
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum: [excel, csv, pdf]
 *           default: excel
 *         description: Export format
 *     responses:
 *       200:
 *         description: File exported successfully
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/export', MaturityController.exportMaturities);

/**
 * @swagger
 * /maturity/bank-accounts:
 *   get:
 *     summary: Get bank accounts
 *     description: Retrieves available bank accounts for maturity processing
 *     tags: [Maturity]
 *     responses:
 *       200:
 *         description: Bank accounts retrieved successfully
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
 *                       id:
 *                         type: integer
 *                       account_code:
 *                         type: string
 *                       name:
 *                         type: string
 *                       account_type_id:
 *                         type: integer
 *                 message:
 *                   type: string
 */
router.get('/bank-accounts', MaturityController.getBankAccounts);

/**
 * @swagger
 * /maturity/processing-history:
 *   get:
 *     summary: Get maturity processing history
 *     description: Retrieves maturity processing history with optional filtering
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter (YYYY-MM-DD)
 *       - in: query
 *         name: userId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Filter by user ID
 *       - in: query
 *         name: authorizationLevel
 *         required: false
 *         schema:
 *           type: string
 *           enum: [level1, level2, level3]
 *         description: Filter by authorization level
 *     responses:
 *       200:
 *         description: Processing history retrieved successfully
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
 *                       id:
 *                         type: integer
 *                       deal_id:
 *                         type: integer
 *                       deal_number:
 *                         type: string
 *                       maturity_action:
 *                         type: string
 *                       principal_amount:
 *                         type: number
 *                       interest_amount:
 *                         type: number
 *                       total_amount:
 *                         type: number
 *                       processed_date:
 *                         type: string
 *                         format: date
 *                       processed_by:
 *                         type: integer
 *                       authorization_level:
 *                         type: string
 *                         enum: [level1, level2, level3]
 *                       bank_account_id:
 *                         type: integer
 *                       processed_by_name:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                 message:
 *                   type: string
 */
router.get('/processing-history', MaturityController.getMaturityProcessingHistory);
// 3-tier blotter endpoints
router.get('/blotter', MaturityController.getMaturityBlotter);

/**
 * @swagger
 * /api/maturity/reinvestment-details:
 *   get:
 *     summary: Get deal details for maturity method 2 (principal reinvestment)
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: dealId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the deal to reinvest
 *       - in: query
 *         name: productType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [money_market, gsec, repo]
 *         description: Type of product (money_market, gsec, or repo)
 *     responses:
 *       200:
 *         description: Deal details retrieved successfully
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
 *                     product_type:
 *                       type: string
 *                     original_deal_id:
 *                       type: integer
 *                     original_deal_number:
 *                       type: string
 *                     principal_amount:
 *                       type: number
 *                     interest_amount:
 *                       type: number
 *                     maturity_date:
 *                       type: string
 *                       format: date
 *                     counterparty_name:
 *                       type: string
 *                     currency:
 *                       type: string
 *                 message:
 *                   type: string
 */
router.get('/reinvestment-details', MaturityController.getDealDetailsForReinvestment);

/**
 * @swagger
 * /api/maturity/amounts:
 *   get:
 *     summary: Get maturity amounts for specific deals
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: dealIds
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated list of deal IDs
 *       - in: query
 *         name: processDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: Process date for maturity calculation (defaults to today)
 *     responses:
 *       200:
 *         description: Maturity amounts retrieved successfully
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
 *                       deal_id:
 *                         type: integer
 *                       deal_number:
 *                         type: string
 *                       product_type:
 *                         type: string
 *                       principal_amount:
 *                         type: number
 *                       interest_amount:
 *                         type: number
 *                       maturity_amount:
 *                         type: number
 *                       interest_rate:
 *                         type: number
 *                       maturity_date:
 *                         type: string
 *                         format: date
 *                       days_to_maturity:
 *                         type: integer
 *                       counterparty_name:
 *                         type: string
 *                 message:
 *                   type: string
 */
router.get('/amounts', MaturityController.getMaturityAmounts);
router.post('/approve', MaturityController.approveMaturities);

/**
 * @swagger
 * /maturity/premature:
 *   get:
 *     summary: Get deals available for premature maturity
 *     description: Retrieves all deals that are not yet matured and can be matured early
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: productType
 *         required: false
 *         schema:
 *           type: string
 *           enum: [all, gsec, money_market, repo]
 *           default: all
 *         description: Product type filter
 *     responses:
 *       200:
 *         description: Deals retrieved successfully
 */
router.get('/premature', MaturityController.getPrematureMaturityDeals);

/**
 * @swagger
 * /maturity/premature:
 *   post:
 *     summary: Mature deals prematurely
 *     description: Updates maturity date for selected deals to mature them early
 *     tags: [Maturity]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dealIds
 *               - prematureMaturityDate
 *               - productType
 *             properties:
 *               dealIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Array of deal IDs to mature prematurely
 *               prematureMaturityDate:
 *                 type: string
 *                 format: date
 *                 description: New maturity date (YYYY-MM-DD)
 *               productType:
 *                 type: string
 *                 enum: [gsec, money_market, repo]
 *                 description: Product type
 *     responses:
 *       200:
 *         description: Deals matured successfully
 */
router.post('/premature', MaturityController.processPrematureMaturity);

/**
 * @swagger
 * /maturity/premature/buyback:
 *   post:
 *     summary: Recalculate and prematurely mature buyback deals
 *     description: Updates Leg 1 interest rate and Leg 2 value date on existing buyback deals, recalculates Leg 2 settlement amount, and logs the premature maturity event
 *     tags: [Maturity]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deals
 *             properties:
 *               deals:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - dealId
 *                     - leg1InterestRate
 *                     - leg2ValueDate
 *                   properties:
 *                     dealId:
 *                       type: integer
 *                     leg1InterestRate:
 *                       type: number
 *                     leg2ValueDate:
 *                       type: string
 *                       format: date
 *                     dayCountBasis:
 *                       type: integer
 *                       enum: [364, 365]
 *                       default: 365
 *     responses:
 *       200:
 *         description: Buyback deals prematurely matured
 */
router.post('/premature/buyback', MaturityController.processBuybackPrematureMaturity);

/**
 * @swagger
 * /maturity/pre-approval/deals:
 *   get:
 *     summary: Get deals available for pre-approval
 *     description: Retrieves all final approved deals across products that can be pre-approved
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: productType
 *         schema:
 *           type: string
 *           enum: [all, gsec, money_market, fixed_deposit]
 *         description: Filter by product type
 *       - in: query
 *         name: dateRange
 *         schema:
 *           type: string
 *         description: Date range filter (format: startDate,endDate)
 *       - in: query
 *         name: counterparty
 *         schema:
 *           type: string
 *         description: Filter by counterparty name
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by pre-approval status
 *     responses:
 *       200:
 *         description: Deals retrieved successfully
 */
router.get('/pre-approval/deals', MaturityController.getPreApprovalDeals);

/**
 * @swagger
 * /maturity/pre-approval/{productType}/{dealId}:
 *   post:
 *     summary: Pre-approve a deal
 *     description: Mark a deal as pre-approved and elevate to authorizer
 *     tags: [Maturity]
 *     parameters:
 *       - in: path
 *         name: productType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [gsec, money_market, fixed_deposit, repo]
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deal pre-approved successfully
 */
router.post('/pre-approval/:productType/:dealId', MaturityController.preApproveDeal);

/**
 * @swagger
 * /maturity/pre-approval/{productType}/{dealId}/approve:
 *   put:
 *     summary: Authorizer approves pre-approval
 *     description: Authorizer approves a pre-approved deal
 *     tags: [Maturity]
 *     parameters:
 *       - in: path
 *         name: productType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [gsec, money_market, fixed_deposit, repo]
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pre-approval approved successfully
 */
router.put('/pre-approval/:productType/:dealId/approve', MaturityController.approvePreApproval);

/**
 * @swagger
 * /maturity/pre-approval/{productType}/{dealId}/reject:
 *   put:
 *     summary: Authorizer rejects pre-approval
 *     description: Authorizer rejects a pre-approved deal
 *     tags: [Maturity]
 *     parameters:
 *       - in: path
 *         name: productType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [gsec, money_market, fixed_deposit, repo]
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Pre-approval rejected successfully
 */
router.put('/pre-approval/:productType/:dealId/reject', MaturityController.rejectPreApproval);

/**
 * @swagger
 * /maturity/pre-approval/blotter:
 *   get:
 *     summary: Get pre-approved deals for blotter
 *     description: Retrieves all deals with pre_approval_status = 'pre_approved' for the blotter
 *     tags: [Maturity]
 *     parameters:
 *       - in: query
 *         name: productType
 *         schema:
 *           type: string
 *           enum: [all, gsec, money_market, fixed_deposit]
 *         description: Filter by product type
 *       - in: query
 *         name: dateRange
 *         schema:
 *           type: string
 *         description: Date range filter (format: startDate,endDate)
 *       - in: query
 *         name: counterparty
 *         schema:
 *           type: string
 *         description: Filter by counterparty name
 *     responses:
 *       200:
 *         description: Pre-approved deals retrieved successfully
 */
router.get('/pre-approval/blotter', MaturityController.getPreApprovedDeals);

module.exports = router;
