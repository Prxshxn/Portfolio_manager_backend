const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { checkAuth } = require('../middleware/auth');

/**
 * Get all Fixed Deposit requests with optional status filter
 * GET /api/fixed-deposit/requests?status=Pending
 */
router.get('/requests', checkAuth, async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fixedDepositRoutes.js:10',message:'GET /requests entry',data:{status:req.query.status,queryParams:req.query},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B'})}).catch(()=>{});
  // #endregion
  try {
    const { status } = req.query;
    
    let query = `
      SELECT 
        fd.*,
        cp.short_name as counterparty_name,
        cp.long_name as counterparty_long_name,
        p.portfolio_name as portfolio_name,
        u.username as submitted_by_name
      FROM fixed_deposit_requests fd
      LEFT JOIN counterparty_master_corporate cp ON fd.counterparty_id = cp.id
      LEFT JOIN portfolio_master p ON CAST(fd.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(p.portfolio_id AS CHAR) COLLATE utf8mb4_unicode_ci
      LEFT JOIN users u ON fd.submitted_by = u.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (status && status !== 'All') {
      // Handle case-insensitive status matching - use the table's collation
      query += ` AND fd.status COLLATE utf8mb4_0900_ai_ci = ? COLLATE utf8mb4_0900_ai_ci`;
      params.push(status);
    }
    
    query += ` ORDER BY fd.created_at DESC`;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fixedDepositRoutes.js:35',message:'before db.query',data:{query:query,params:params},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B'})}).catch(()=>{});
    // #endregion
    
    const [requests] = await db.query(query, params);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fixedDepositRoutes.js:37',message:'after db.query',data:{requestsCount:requests.length,firstRequest:requests[0]||null,allRequestIds:requests.map(r=>r.id),allStatuses:requests.map(r=>r.status)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B'})}).catch(()=>{});
    // #endregion
    
    console.log(`Fetched ${requests.length} fixed deposit requests for status: ${status || 'All'}`);
    res.json(requests);
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fixedDepositRoutes.js:42',message:'GET /requests error',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B'})}).catch(()=>{});
    // #endregion
    console.error('Error fetching fixed deposit requests:', error);
    console.error('Error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch fixed deposit requests', details: error.message });
  }
});

/**
 * Get a single Fixed Deposit request by ID
 * GET /api/fixed-deposit/requests/:id
 */
router.get('/requests/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [requests] = await db.query(
      `SELECT 
        fd.*,
        cp.short_name as counterparty_name,
        cp.long_name as counterparty_long_name,
        p.portfolio_name as portfolio_name,
        u.username as submitted_by_name
      FROM fixed_deposit_requests fd
      LEFT JOIN counterparty_master_corporate cp ON fd.counterparty_id = cp.id
      LEFT JOIN portfolio_master p ON fd.portfolio_id = p.portfolio_id
      LEFT JOIN users u ON fd.submitted_by = u.id
      WHERE fd.id = ?`,
      [id]
    );
    
    if (requests.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    res.json(requests[0]);
  } catch (error) {
    console.error('Error fetching fixed deposit request:', error);
    res.status(500).json({ error: 'Failed to fetch fixed deposit request' });
  }
});

/**
 * Create a new Fixed Deposit request
 * POST /api/fixed-deposit/requests
 */
router.post('/requests', checkAuth, async (req, res) => {
  try {
    const user = req.user || JSON.parse(req.headers['x-user'] || '{}');
    const userId = user.id || user.userId;
    
    const {
      portfolio,
      book,
      module,
      requestNo,
      fileNumber,
      status,
      counterpartyType,
      counterpartyName,
      contactPerson,
      requestRemarks,
      instrumentType,
      isin,
      currency,
      requestedAmount,
      targetYield,
      valueDate,
      maturityDate,
      approvalCategory,
      approverId,
      approverName,
      approverDesignation,
      approvalLimitRequired,
      approverNotes
    } = req.body;
    
    // Find counterparty ID from issuer_id (from Issuer Master)
    let counterpartyId = null;
    if (counterpartyName) {
      // First try to find in issuer_master by issuer_id
      const [issuerRows] = await db.query(
        `SELECT id FROM issuer_master WHERE issuer_id = ? LIMIT 1`,
        [counterpartyName]
      );
      if (issuerRows.length > 0) {
        counterpartyId = issuerRows[0].id;
      } else {
        // Fallback to counterparty_master_corporate
        const [cpRows] = await db.query(
          `SELECT id FROM counterparty_master_corporate WHERE issuer_id = ? OR id = ? LIMIT 1`,
          [counterpartyName, counterpartyName]
        );
        if (cpRows.length > 0) {
          counterpartyId = cpRows[0].id;
        }
      }
    }
    
    // Use approverName if provided, otherwise fall back to approvalCategory
    const approvalCategoryValue = approverName || approvalCategory || null;
    
    const [result] = await db.query(
      `INSERT INTO fixed_deposit_requests (
        portfolio_id, book, module, request_no, file_number, status,
        counterparty_type, counterparty_id, contact_person, request_remarks,
        instrument_type, isin, currency, requested_amount, target_yield,
        value_date, maturity_date,
        approver_id, approver_name, approver_designation, approval_category,
        approval_limit_required, approver_notes,
        submitted_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        portfolio || null,
        book || null,
        module || 'Pre approval',
        requestNo,
        fileNumber || null,
        status || 'Draft',
        counterpartyType || 'Bank',
        counterpartyId,
        contactPerson || null,
        requestRemarks || null,
        instrumentType || null,
        isin || null,
        currency || 'LKR',
        requestedAmount ? parseFloat(requestedAmount) : null,
        targetYield ? parseFloat(targetYield) : null,
        valueDate,
        maturityDate,
        approverId || null,
        approverName || null,
        approverDesignation || null,
        approvalCategoryValue,
        approvalLimitRequired || null,
        approverNotes || null,
        userId
      ]
    );
    
    res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Fixed deposit request created successfully'
    });
  } catch (error) {
    console.error('Error creating fixed deposit request:', error);
    res.status(500).json({ error: 'Failed to create fixed deposit request', details: error.message });
  }
});

/**
 * Update a Fixed Deposit request
 * PUT /api/fixed-deposit/requests/:id
 */
router.put('/requests/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      portfolio,
      book,
      fileNumber,
      status,
      counterpartyName,
      contactPerson,
      requestRemarks,
      instrumentType,
      isin,
      currency,
      requestedAmount,
      targetYield,
      valueDate,
      maturityDate,
      approvalCategory,
      approvalLimitRequired,
      approverNotes
    } = req.body;
    
    // Find counterparty ID if counterparty name provided
    let counterpartyId = null;
    if (counterpartyName) {
      const [cpRows] = await db.query(
        `SELECT id FROM counterparty_master_corporate WHERE unique_id = ? OR short_name = ? LIMIT 1`,
        [counterpartyName, counterpartyName]
      );
      if (cpRows.length > 0) {
        counterpartyId = cpRows[0].id;
      }
    }
    
    const updateFields = [];
    const updateValues = [];
    
    if (portfolio !== undefined) { updateFields.push('portfolio_id = ?'); updateValues.push(portfolio); }
    if (book !== undefined) { updateFields.push('book = ?'); updateValues.push(book); }
    if (fileNumber !== undefined) { updateFields.push('file_number = ?'); updateValues.push(fileNumber); }
    if (status !== undefined) { updateFields.push('status = ?'); updateValues.push(status); }
    if (counterpartyId !== null) { updateFields.push('counterparty_id = ?'); updateValues.push(counterpartyId); }
    if (contactPerson !== undefined) { updateFields.push('contact_person = ?'); updateValues.push(contactPerson); }
    if (requestRemarks !== undefined) { updateFields.push('request_remarks = ?'); updateValues.push(requestRemarks); }
    if (instrumentType !== undefined) { updateFields.push('instrument_type = ?'); updateValues.push(instrumentType); }
    if (isin !== undefined) { updateFields.push('isin = ?'); updateValues.push(isin); }
    if (currency !== undefined) { updateFields.push('currency = ?'); updateValues.push(currency); }
    if (requestedAmount !== undefined) { updateFields.push('requested_amount = ?'); updateValues.push(parseFloat(requestedAmount)); }
    if (targetYield !== undefined) { updateFields.push('target_yield = ?'); updateValues.push(parseFloat(targetYield)); }
    if (valueDate !== undefined) { updateFields.push('value_date = ?'); updateValues.push(valueDate); }
    if (maturityDate !== undefined) { updateFields.push('maturity_date = ?'); updateValues.push(maturityDate); }
    if (approvalCategory !== undefined) { updateFields.push('approval_category = ?'); updateValues.push(approvalCategory); }
    if (approvalLimitRequired !== undefined) { updateFields.push('approval_limit_required = ?'); updateValues.push(approvalLimitRequired); }
    if (approverNotes !== undefined) { updateFields.push('approver_notes = ?'); updateValues.push(approverNotes); }
    
    updateFields.push('updated_at = NOW()');
    updateValues.push(id);
    
    if (updateFields.length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    await db.query(
      `UPDATE fixed_deposit_requests SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    res.json({ success: true, message: 'Fixed deposit request updated successfully' });
  } catch (error) {
    console.error('Error updating fixed deposit request:', error);
    res.status(500).json({ error: 'Failed to update fixed deposit request', details: error.message });
  }
});

/**
 * Approve a Fixed Deposit request
 * PUT /api/fixed-deposit/requests/:id/approve
 */
router.put('/requests/:id/approve', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user || JSON.parse(req.headers['x-user'] || '{}');
    const { approverNotes } = req.body;
    
    await db.query(
      `UPDATE fixed_deposit_requests 
       SET status = 'Approved', 
           approver_notes = ?,
           approved_by = ?,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [approverNotes || null, user.id || user.userId, id]
    );
    
    res.json({ success: true, message: 'Request approved successfully' });
  } catch (error) {
    console.error('Error approving request:', error);
    res.status(500).json({ error: 'Failed to approve request', details: error.message });
  }
});

/**
 * Reject a Fixed Deposit request
 * PUT /api/fixed-deposit/requests/:id/reject
 */
router.put('/requests/:id/reject', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user || JSON.parse(req.headers['x-user'] || '{}');
    const { approverNotes } = req.body;
    
    await db.query(
      `UPDATE fixed_deposit_requests 
       SET status = 'Returned', 
           approver_notes = ?,
           rejected_by = ?,
           rejected_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [approverNotes || null, user.id || user.userId, id]
    );
    
    res.json({ success: true, message: 'Request rejected successfully' });
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(500).json({ error: 'Failed to reject request', details: error.message });
  }
});

module.exports = router;
