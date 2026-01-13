const express = require('express');
const router = express.Router();

// Import your DB connection (adjust path as needed)
const pool = require('../db');
const CashflowCaptureService = require('../services/cashflowCaptureService');

/**
 * @swagger
 * /money-market-deals:
 *   post:
 *     summary: Create a new money market deal
 *     description: Creates a new money market deal. Requires authentication.
 *     tags:
 *       - Money Market Deals
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tradeDate
 *               - valueDate
 *               - maturityDate
 *               - counterpartyId
 *               - productType
 *               - currency
 *               - principalAmount
 *               - interestRate
 *               - tenor
 *               - interestAmount
 *               - maturityValue
 *               - settlementMode
 *             properties:
 *               tradeDate:
 *                 type: string
 *                 example: '2025-07-24'
 *               valueDate:
 *                 type: string
 *                 example: '2025-07-24'
 *               maturityDate:
 *                 type: string
 *                 example: '2025-08-24'
 *               counterpartyId:
 *                 type: integer
 *                 example: 1
 *               productType:
 *                 type: string
 *                 example: MMAR
 *               currency:
 *                 type: string
 *                 example: 'LKR'
 *               principalAmount:
 *                 type: number
 *                 example: 1000000
 *               interestRate:
 *                 type: number
 *                 example: 8.5
 *               tenor:
 *                 type: integer
 *                 example: 30
 *               interestAmount:
 *                 type: number
 *                 example: 7000
 *               maturityValue:
 *                 type: number
 *                 example: 1007000
 *               settlementMode:
 *                 type: string
 *                 example: 'RTGS'
 *               remarks:
 *                 type: string
 *                 example: 'Test deal'
 *               dealType:
 *                 type: string
 *                 example: 'primary'
 *     responses:
 *       201:
 *         description: Deal created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 id:
 *                   type: integer
 *                 dealNumber:
 *                   type: string
 *       500:
 *         description: Failed to create deal
 */
// POST /api/money-market-deals - Save a new deal
router.post('/', async (req, res) => {
  const deal = req.body;
  try {
    // Holiday validation - check if transaction dates are holidays
    const holidayValidationService = require('../services/holidayValidationService');
    const currency = deal.currency || 'LKR';
    const holidayValidation = await holidayValidationService.validateTransactionDates({
      tradeDate: deal.tradeDate,
      valueDate: deal.valueDate,
      currency: currency
    });

    if (holidayValidation.isHoliday) {
      return res.status(400).json({
        success: false,
        message: holidayValidation.message,
        error: 'Transaction cannot be saved on a holiday'
      });
    }

    // Format date to YYYYMMDD
    const tradeDate = new Date(deal.tradeDate);
    const yyyy = tradeDate.getFullYear();
    const mm = String(tradeDate.getMonth() + 1).padStart(2, '0');
    const dd = String(tradeDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;
    const productCode = deal.productType;

    // Get max sequence for this date and product
    const [rows] = await pool.query(
      `SELECT MAX(CAST(RIGHT(deal_number, 4) AS UNSIGNED)) as maxSeq
       FROM money_market_deals
       WHERE trade_date = ? AND product_type = ?`,
      [deal.tradeDate, productCode]
    );
    let nextSeq = 1;
    if (rows.length > 0 && rows[0].maxSeq !== null) {
      nextSeq = rows[0].maxSeq + 1;
    }
    const seqStr = String(nextSeq).padStart(4, '0');
    const dealNumber = `${dateStr}${productCode}${seqStr}`;

    // Get user ID from username if provided
    let userId = null;
    if (deal.userId || deal.created_by) {
      userId = deal.userId || deal.created_by;
    } else if (deal.username) {
      const [userRows] = await pool.query('SELECT id FROM users WHERE username = ?', [deal.username]);
      if (userRows.length > 0) {
        userId = userRows[0].id;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO money_market_deals
      (deal_number, trade_date, value_date, maturity_date, counterparty_id, product_type, currency, principal_amount, interest_rate, tenor, interest_amount, maturity_value, settlement_mode, remarks, deal_type, created_by, status, current_approval_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'front_office')`,
      [
        dealNumber, deal.tradeDate, deal.valueDate, deal.maturityDate, deal.counterpartyId, deal.productType,
        deal.currency, deal.principalAmount, deal.interestRate, deal.tenor, deal.interestAmount, deal.maturityValue,
        deal.settlementMode, deal.remarks, deal.dealType || null, userId
      ]
    );

    // Capture cashflow for the new deal
    try {
      await CashflowCaptureService.captureMoneyMarketCashflow(
        result.insertId,
        deal.dealType || 'lending',
        deal.principalAmount,
        deal.tradeDate,
        deal.counterpartyId
      );
    } catch (cashflowError) {
      console.error('Error capturing cashflow for money market deal:', cashflowError);
      // Don't fail the main process if cashflow capture fails
    }

    // Ledger entries are now only posted after final approval, not here.
    res.status(201).json({ success: true, message: 'Deal saved', id: result.insertId, dealNumber });
  } catch (err) {
    // Return the full error object for debugging
    res.status(500).json({ success: false, message: 'Failed to save deal', error: err.message, stack: err.stack, full: err });
  }
});

/**
 * @swagger
 * /money-market-deals:
 *   get:
 *     summary: List all money market deals
 *     description: Returns a list of all money market deals. Requires authentication. Optional query param 'limit' to restrict results.
 *     tags:
 *       - Money Market Deals
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Limit the number of deals returned
 *     responses:
 *       200:
 *         description: List of deals
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Failed to retrieve deals
 */
// GET /api/money-market-deals - List all deals, or limit if ?limit=N
router.get('/', async (req, res) => {
  try {
    let sql = 'SELECT * FROM money_market_deals ORDER BY trade_date DESC, id DESC';
    const values = [];
    if (req.query.limit) {
      sql += ' LIMIT ?';
      values.push(Number(req.query.limit));
    }
    const [rows] = await pool.query(sql, values);
    
    // Format dates to ensure consistent YYYY-MM-DD format
    const formattedRows = rows.map(deal => ({
      ...deal,
      trade_date: deal.trade_date ? formatDate(deal.trade_date) : null,
      value_date: deal.value_date ? formatDate(deal.value_date) : null,
      maturity_date: deal.maturity_date ? formatDate(deal.maturity_date) : null,
      authorized_at: deal.authorized_at ? formatDateTime(deal.authorized_at) : null
    }));
    
    res.json({ success: true, data: formattedRows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch deals', error: err.message });
  }
});

// Helper function to format dates
function formatDate(date) {
  if (!date) return null;
  if (typeof date === 'string') {
    // If already a string, return first 10 characters (YYYY-MM-DD)
    return date.slice(0, 10);
  }
  // If Date object, format it
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper function to format datetime
function formatDateTime(dateTime) {
  if (!dateTime) return null;
  if (typeof dateTime === 'string') {
    return dateTime;
  }
  // If Date object, format it
  const d = new Date(dateTime);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// PUT /api/money-market-deals/:deal_number - Update status/authorization
router.put('/:deal_number', async (req, res) => {
  const dealNumber = req.params.deal_number;
  const {
    status,
    current_approval_level,
    comment,
    authorized_by,
    authorized_at
  } = req.body;

  // Build dynamic update query
  const fields = [];
  const values = [];
  if (status !== undefined) {
    fields.push('status = ?');
    values.push(status);
  }
  if (current_approval_level !== undefined) {
    fields.push('current_approval_level = ?');
    values.push(current_approval_level);
  }
  // Allow updating deal fields for rejected deals (when status is being changed from rejected to draft)
  if (req.body.tradeDate !== undefined) {
    fields.push('trade_date = ?');
    values.push(req.body.tradeDate);
  }
  if (req.body.valueDate !== undefined) {
    fields.push('value_date = ?');
    values.push(req.body.valueDate);
  }
  if (req.body.maturityDate !== undefined) {
    fields.push('maturity_date = ?');
    values.push(req.body.maturityDate);
  }
  if (req.body.counterpartyId !== undefined) {
    fields.push('counterparty_id = ?');
    values.push(req.body.counterpartyId);
  }
  if (req.body.productType !== undefined) {
    fields.push('product_type = ?');
    values.push(req.body.productType);
  }
  if (req.body.currency !== undefined) {
    fields.push('currency = ?');
    values.push(req.body.currency);
  }
  if (req.body.principalAmount !== undefined) {
    fields.push('principal_amount = ?');
    values.push(req.body.principalAmount);
  }
  if (req.body.interestRate !== undefined) {
    fields.push('interest_rate = ?');
    values.push(req.body.interestRate);
  }
  if (req.body.tenor !== undefined) {
    fields.push('tenor = ?');
    values.push(req.body.tenor);
  }
  if (req.body.interestAmount !== undefined) {
    fields.push('interest_amount = ?');
    values.push(req.body.interestAmount);
  }
  if (req.body.maturityValue !== undefined) {
    fields.push('maturity_value = ?');
    values.push(req.body.maturityValue);
  }
  if (req.body.settlementMode !== undefined) {
    fields.push('settlement_mode = ?');
    values.push(req.body.settlementMode);
  }
  if (req.body.remarks !== undefined) {
    fields.push('remarks = ?');
    values.push(req.body.remarks);
  }
  if (req.body.dealType !== undefined) {
    fields.push('deal_type = ?');
    values.push(req.body.dealType);
  }
  if (comment !== undefined) {
    fields.push('comment = ?');
    values.push(comment);
  }
  if (authorized_by !== undefined) {
    // authorized_by can be either username (string) or user ID (number)
    // If it's a string, look up the user ID
    let userId = authorized_by;
    if (typeof authorized_by === 'string') {
      try {
        const [userRows] = await pool.query('SELECT id FROM users WHERE username = ?', [authorized_by]);
        if (userRows.length > 0) {
          userId = userRows[0].id;
        } else {
          console.warn(`User not found for username: ${authorized_by}, using null for authorized_by`);
          userId = null;
        }
      } catch (userError) {
        console.error('Error looking up user:', userError);
        userId = null;
      }
    }
    fields.push('authorized_by = ?');
    values.push(userId);
  }
  if (authorized_at !== undefined) {
    fields.push('authorized_at = ?');
    values.push(authorized_at);
  }
  if (fields.length === 0) {
    return res.status(400).json({ success: false, message: 'No fields to update' });
  }
  try {
    const updateQuery = `UPDATE money_market_deals SET ${fields.join(', ')} WHERE deal_number = ?`;
    const updateValues = [...values, dealNumber];
    console.log('Money Market Update Query:', updateQuery);
    console.log('Money Market Update Values:', updateValues);
    const [result] = await pool.query(updateQuery, updateValues);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }
    // Return the updated deal
    const [rows] = await pool.query('SELECT * FROM money_market_deals WHERE deal_number = ?', [dealNumber]);

    // === Trigger ledger entry posting if deal is now final_approved ===
    if (status === 'final_approved' && current_approval_level === 'final_approved') {
      try {
      // Check if ledger entries already exist for this deal_number
      const [ledgerRows] = await pool.query('SELECT COUNT(*) as cnt FROM ledger_entries WHERE deal_number = ?', [dealNumber]);
      if (ledgerRows[0].cnt === 0) {
        // Fetch the deal details
        const [dealRows] = await pool.query('SELECT * FROM money_market_deals WHERE deal_number = ?', [dealNumber]);
        const deal = dealRows[0];
          
          if (!deal) {
            console.error('Deal not found for ledger entry creation:', dealNumber);
            return res.json({ success: true, data: rows[0] });
          }
          
        // Lookup the selected settlement account by bank_payment_code
          let settlementAccount = null;
          if (deal.settlement_mode) {
        const [settlementRows] = await pool.query('SELECT * FROM settlement_accounts WHERE bank_payment_code = ?', [deal.settlement_mode]);
            settlementAccount = settlementRows[0];
          }
          
        // Get the chart of accounts entry using the ledger_account_code from settlement_accounts
        let coaAccount = null;
        if (settlementAccount && settlementAccount.ledger_account_code) {
          const [coaRows] = await pool.query('SELECT * FROM chart_of_accounts WHERE account_code = ?', [settlementAccount.ledger_account_code]);
          coaAccount = coaRows[0];
        }
          
        // Get account codes from mapping service
        const accountMapping = require('../services/accountMappingService');
        const lendingControlCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_CONTROL);
        const loanLiabilityCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LOAN_LIABILITY);
        
        const [lendingControlAccounts] = await pool.query("SELECT * FROM chart_of_accounts WHERE account_code = ?", [lendingControlCode]);
        const lendingControl = lendingControlAccounts[0];
        const [loanLiabilityAccounts] = await pool.query("SELECT * FROM chart_of_accounts WHERE account_code = ?", [loanLiabilityCode]);
        const loanLiability = loanLiabilityAccounts[0];
          
          if (!lendingControl || !loanLiability) {
            console.error('Required chart of accounts entries not found for ledger posting');
            return res.json({ success: true, data: rows[0] });
          }
          
        const amount = deal.principal_amount;
          const dealType = deal.deal_type || 'Lending'; // Default to Lending if not specified
          
          if (dealType === 'Borrowing') {
            if (!coaAccount || !loanLiability) {
              console.error('Missing accounts for Borrowing ledger entry');
              return res.json({ success: true, data: rows[0] });
            }
          // DR: Bank (coaAccount), CR: Loan Liability
          await pool.query(
            'INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, description) VALUES (?, ?, NOW(), ?, 0, ?)',
            [dealNumber, coaAccount.id, amount, 'Borrowing - DR Bank']
          );
          await pool.query(
            'INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, description) VALUES (?, ?, NOW(), 0, ?, ?)',
            [dealNumber, loanLiability.id, amount, 'Borrowing - CR Loan Liability']
          );
          } else if (dealType === 'Lending') {
            if (!coaAccount || !lendingControl) {
              console.error('Missing accounts for Lending ledger entry');
              return res.json({ success: true, data: rows[0] });
            }
          // DR: Lending Control (1-315-01-01-01), CR: Selected Bank Account
          await pool.query(
            'INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, description) VALUES (?, ?, NOW(), ?, 0, ?)',
            [dealNumber, lendingControl.id, amount, 'Lending - DR Lending Control']
          );
          await pool.query(
            'INSERT INTO ledger_entries (deal_number, account_id, entry_date, debit_amount, credit_amount, description) VALUES (?, ?, NOW(), 0, ?, ?)',
              [dealNumber, coaAccount.id, amount, `Lending - CR ${coaAccount.name || 'Bank Account'}`]
          );
          }
        }
      } catch (ledgerError) {
        // Log the error but don't fail the approval
        console.error('Error creating ledger entries for money market deal:', ledgerError);
        // Continue with the response even if ledger entry fails
      }
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update deal', error: err.message });
  }
});

module.exports = router;
