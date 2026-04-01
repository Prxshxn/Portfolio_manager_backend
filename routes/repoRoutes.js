const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const repoDealController = require('../controllers/repoDealController');

/**
 * @swagger
 * tags:
 *   - name: Repo Deals
 *     description: Repo and Reverse Repo deal management operations. This system handles the complete lifecycle of repo transactions including creation, updates, status management, and reporting. All endpoints require JWT authentication.
 * 
 * components:
 *   schemas:
 *     RepoDeal:
 *       type: object
 *       required:
 *         - dealType
 *         - counterparty
 *         - counterpartyType
 *         - tradeDate
 *         - valueDate
 *         - maturityDate
 *         - principalAmount
 *         - rate
 *         - tenor
 *         - calculationDayBasis
 *         - isin
 *       properties:
 *         id:
 *           type: integer
 *           description: Auto-generated unique identifier
 *         dealType:
 *           type: string
 *           enum: [Repo, Reverse Repo]
 *           description: Type of repo deal
 *         counterparty:
 *           type: integer
 *           description: Counterparty ID from the respective counterparty table

 *         tradeDate:
 *           type: string
 *           format: date
 *           description: Date when the deal was traded (YYYY-MM-DD)
 *         valueDate:
 *           type: string
 *           format: date
 *           description: Date when the deal becomes effective (YYYY-MM-DD)
 *         maturityDate:
 *           type: string
 *           format: date
 *           description: Date when the deal matures (YYYY-MM-DD)
 *         principalAmount:
 *           type: number
 *           format: float
 *           minimum: 0
 *           description: Principal amount of the deal
 *         interestAmount:
 *           type: number
 *           format: float
 *           description: Calculated interest amount
 *         rate:
 *           type: number
 *           format: float
 *           minimum: 0
 *           description: Interest rate percentage
 *         maturityAmount:
 *           type: number
 *           format: float
 *           description: Total amount at maturity (principal + interest)
 *         tenor:
 *           type: integer
 *           minimum: 0
 *           description: Number of days from value date to maturity date
 *         calculationDayBasis:
 *           type: integer
 *           enum: [364, 365]
 *           description: Day basis for interest calculation
 *         isin:
 *           type: string
 *           description: Primary ISIN (kept for backward compatibility)
 *         isins:
 *           type: array
 *           description: Optional list of ISINs attached to the deal
 *           items:
 *             type: object
 *             properties:
 *               isin:
 *                 type: string
 *                 description: ISIN number
 *               faceValue:
 *                 type: number
 *                 description: Optional face value tagged to this ISIN
 *         issueDate:
 *           type: string
 *           description: Issue date of the security (DD/MM/YYYY format)
 *         haircut:
 *           type: number
 *           format: float
 *           minimum: 0
 *           maximum: 100
 *           description: Haircut percentage applied to the security
 *         faceValue:
 *           type: number
 *           format: float
 *           minimum: 0
 *           description: Face value of the security
 *         status:
 *           type: string
 *           enum: [Pending, Active, Matured, Cancelled]
 *           default: Pending
 *           description: Current status of the deal
 *         createdBy:
 *           type: integer
 *           description: ID of the user who created the deal
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Timestamp when the deal was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Timestamp when the deal was last updated
 *         counterpartyName:
 *           type: string
 *           description: Name of the counterparty (from joined table)
 *         counterpartyLongName:
 *           type: string
 *           description: Long name of the counterparty (from joined table)
 *         createdByName:
 *           type: string
 *           description: Username of the user who created the deal
 *     
 *     RepoDealCreate:
 *       type: object
 *       required:
 *         - dealType
 *         - counterparty
 *         - counterpartyType
 *         - tradeDate
 *         - valueDate
 *         - maturityDate
 *         - principalAmount
 *         - rate
 *         - tenor
 *         - calculationDayBasis
 *         - isin
 *       properties:
 *         dealType:
 *           type: string
 *           enum: [Repo, Reverse Repo]
 *         counterparty:
 *           type: integer
 *         counterpartyType:
 *           type: string
 *           enum: [corporate, individual, joint]
 *         tradeDate:
 *           type: string
 *           format: date
 *         valueDate:
 *           type: string
 *           format: date
 *         maturityDate:
 *           type: string
 *           format: date
 *         principalAmount:
 *           type: number
 *         interestAmount:
 *           type: number
 *         rate:
 *           type: number
 *         maturityAmount:
 *           type: number
 *         tenor:
 *           type: integer
 *         calculationDayBasis:
 *           type: integer
 *           enum: [364, 365]
 *         isin:
 *           type: string
 *         isins:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               isin:
 *                 type: string
 *               faceValue:
 *                 type: number
 *         issueDate:
 *           type: string
 *         haircut:
 *           type: number
 *         faceValue:
 *           type: number
 *     
 *     RepoDealUpdate:
 *       type: object
 *       properties:
 *         dealType:
 *           type: string
 *           enum: [Repo, Reverse Repo]
 *         counterparty:
 *           type: integer
 *         counterpartyType:
 *           type: string
 *           enum: [corporate, individual, joint]
 *         tradeDate:
 *           type: string
 *           format: date
 *         valueDate:
 *           type: string
 *           format: date
 *         maturityDate:
 *           type: string
 *           format: date
 *         principalAmount:
 *           type: number
 *         interestAmount:
 *           type: number
 *         rate:
 *           type: number
 *         maturityAmount:
 *           type: number
 *         tenor:
 *           type: integer
 *         calculationDayBasis:
 *           type: integer
 *           enum: [364, 365]
 *         isin:
 *           type: string
 *         issueDate:
 *           type: string
 *         haircut:
 *           type: number
 *         faceValue:
 *           type: number
 *         status:
 *           type: string
 *           enum: [Pending, Active, Matured, Cancelled]
 *     
 *     RepoDealStatusUpdate:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: [Pending, Active, Matured, Cancelled]
 *     
 *     ApiResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           oneOf:
 *             - $ref: '#/components/schemas/RepoDeal'
 *             - type: array
 *               items:
 *                 $ref: '#/components/schemas/RepoDeal'
 *             - type: object
 *         error:
 *           type: string
 *     
 *     RepoDealFilters:
 *       type: object
 *       properties:
 *         dealType:
 *           type: string
 *           enum: [Repo, Reverse Repo]
 *           description: Filter by deal type
 *         status:
 *           type: string
 *           enum: [Pending, Active, Matured, Cancelled]
 *           description: Filter by deal status
 *         counterpartyId:
 *           type: integer
 *           description: Filter by counterparty ID
 *         startDate:
 *           type: string
 *           format: date
 *           description: Filter deals from this date (YYYY-MM-DD)
 *         endDate:
 *           type: string
 *           format: date
 *           description: Filter deals until this date (YYYY-MM-DD)
 *     
 *     RepoDealSummary:
 *       type: object
 *       properties:
 *         totalDeals:
 *           type: integer
 *           description: Total number of repo deals
 *         activeDeals:
 *           type: integer
 *           description: Number of active deals
 *         maturedDeals:
 *           type: integer
 *           description: Number of matured deals
 *         pendingDeals:
 *           type: integer
 *           description: Number of pending deals
 *         totalPrincipal:
 *           type: number
 *           format: float
 *           description: Total principal amount of active deals
 *         totalInterest:
 *           type: number
 *           format: float
 *           description: Total interest amount of active deals
 *         avgRate:
 *           type: number
 *           format: float
 *           description: Average rate of active deals
 */

/**
 * @swagger
 * /api/repo-deals:
 *   post:
 *     summary: Create a new repo deal
 *     description: Create a new repo or reverse repo deal with all required details
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RepoDealCreate'
 *           example:
 *             dealType: "Repo"
 *             counterparty: 1
 *             counterpartyType: "corporate"
 *             tradeDate: "2025-01-25"
 *             valueDate: "2025-01-26"
 *             maturityDate: "2025-02-25"
 *             principalAmount: 1000000
 *             interestAmount: 12328.77
 *             rate: 6.50
 *             maturityAmount: 1012328.77
 *             tenor: 30
 *             calculationDayBasis: 365
 *             isin: "IN1234567890"
 *             isins: [
 *               { isin: "IN1234567890", faceValue: 500000 },
 *               { isin: "IN0987654321", faceValue: 500000 }
 *             ]
 *             issueDate: "25/01/2025"
 *             haircut: 2.50
 *             faceValue: 1000000
 *     responses:
 *       201:
 *         description: Repo deal created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "Repo deal created successfully"
 *               data:
 *                 id: 3
 *                 dealType: "Repo"
 *                 counterparty: 1
 *                 counterpartyType: "corporate"
 *                 status: "Pending"
 *       400:
 *         description: Bad request - validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: false
 *               message: "Missing required fields"
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 *   get:
 *     summary: Get all repo deals
 *     description: Retrieve all repo deals with optional filtering and pagination
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dealType
 *         schema:
 *           type: string
 *           enum: [Repo, Reverse Repo]
 *         description: Filter by deal type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Pending, Active, Matured, Cancelled]
 *         description: Filter by deal status
 *       - in: query
 *         name: counterpartyId
 *         schema:
 *           type: integer
 *         description: Filter by counterparty ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter deals from this date (YYYY-MM-DD)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter deals until this date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: List of repo deals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 * /api/repo-deals/{id}:
 *   get:
 *     summary: Get repo deal by ID
 *     description: Retrieve a specific repo deal by its unique identifier
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Unique identifier of the repo deal
 *     responses:
 *       200:
 *         description: Repo deal retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request - invalid ID format
 *       404:
 *         description: Repo deal not found
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 *   put:
 *     summary: Update repo deal
 *     description: Update an existing repo deal. Cannot update matured or cancelled deals.
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Unique identifier of the repo deal to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RepoDealUpdate'
 *     responses:
 *       200:
 *         description: Repo deal updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request - validation error or cannot update
 *       404:
 *         description: Repo deal not found
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 *   delete:
 *     summary: Delete repo deal
 *     description: Delete a repo deal. Can only delete pending deals.
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Unique identifier of the repo deal to delete
 *     responses:
 *       200:
 *         description: Repo deal deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request - cannot delete non-pending deals
 *       404:
 *         description: Repo deal not found
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 * /api/repo-deals/{id}/status:
 *   patch:
 *     summary: Update repo deal status
 *     description: Update the status of a repo deal (Pending, Active, Matured, Cancelled)
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Unique identifier of the repo deal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RepoDealStatusUpdate'
 *           example:
 *             status: "Active"
 *     responses:
 *       200:
 *         description: Repo deal status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request - invalid status or validation error
 *       404:
 *         description: Repo deal not found
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 * /api/repo-deals/counterparty/{counterpartyId}:
 *   get:
 *     summary: Get repo deals by counterparty
 *     description: Retrieve all repo deals for a specific counterparty
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: counterpartyId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the counterparty
 *     responses:
 *       200:
 *         description: Repo deals for counterparty retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request - invalid counterparty ID
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 * /api/repo-deals/isin/{isinNumber}:
 *   get:
 *     summary: Get repo deals by ISIN
 *     description: Retrieve all repo deals for a specific ISIN number
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: isinNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: ISIN number of the security
 *     responses:
 *       200:
 *         description: Repo deals for ISIN retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request - ISIN number required
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 * /api/repo-deals/status/active:
 *   get:
 *     summary: Get active repo deals
 *     description: Retrieve all currently active repo deals
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active repo deals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 * /api/repo-deals/expiring/soon:
 *   get:
 *     summary: Get expiring repo deals
 *     description: Retrieve repo deals expiring within specified days
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 7
 *         description: Number of days to look ahead for expiring deals
 *     responses:
 *       200:
 *         description: Expiring repo deals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         description: Bad request - invalid days parameter
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 * 
 * /api/repo-deals/summary/stats:
 *   get:
 *     summary: Get repo deals summary statistics
 *     description: Retrieve summary statistics for all repo deals
 *     tags: [Repo Deals]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *             example:
 *               success: true
 *               message: "Repo deals summary retrieved successfully"
 *               data:
 *                 totalDeals: 5
 *                 activeDeals: 3
 *                 maturedDeals: 1
 *                 pendingDeals: 1
 *                 totalPrincipal: 2500000
 *                 totalInterest: 45657.53
 *                 avgRate: 6.75
 *       401:
 *         description: Unauthorized - authentication required
 *       500:
 *         description: Internal server error
 */

// Create new repo deal
router.post('/', auth, repoDealController.create);

// Backfill ledger entries for approved repo deals (must be before /:id to avoid capture)
router.post('/backfill-ledger', auth, repoDealController.backfillLedger);

// Get all repo deals with optional filters
router.get('/', auth, repoDealController.getAll);

// Get repo deal by ID
router.get('/:id', auth, repoDealController.getById);

// Update repo deal
router.put('/:id', auth, repoDealController.update);

// Delete repo deal
router.delete('/:id', auth, repoDealController.delete);

// Update deal status
router.patch('/:id/status', auth, repoDealController.updateStatus);

// 3-tier approval workflow (separate from lifecycle status)
router.patch('/:id/approval', auth, repoDealController.updateApprovalStatus);

// Get repo deals by counterparty
router.get('/counterparty/:counterpartyId', auth, repoDealController.getByCounterparty);

// Get repo deals by ISIN
router.get('/isin/:isinNumber', auth, repoDealController.getByIsin);

// Get active repo deals
router.get('/status/active', auth, repoDealController.getActive);

// Get expiring repo deals
router.get('/expiring/soon', auth, repoDealController.getExpiringSoon);

// Get summary statistics
router.get('/summary/stats', auth, repoDealController.getSummary);

module.exports = router;
