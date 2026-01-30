const db = require('../config/db');

const FixedDepositRequest = {
  /**
   * Get all fixed deposit requests
   * @param {Object} filters - Optional filters (status, portfolio_id, etc.)
   * @returns {Promise<Array>} Array of fixed deposit requests
   */
  getAll: async (filters = {}) => {
    try {
      let sql = 'SELECT * FROM fixed_deposit_requests WHERE 1=1';
      const params = [];

      if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
      }

      if (filters.portfolio_id) {
        sql += ' AND portfolio_id = ?';
        params.push(filters.portfolio_id);
      }

      if (filters.request_no) {
        sql += ' AND request_no = ?';
        params.push(filters.request_no);
      }

      sql += ' ORDER BY created_at DESC';

      const [rows] = await db.query(sql, params);
      return rows;
    } catch (error) {
      console.error('Error getting all fixed deposit requests:', error);
      throw error;
    }
  },

  /**
   * Get a fixed deposit request by ID
   * @param {number} id - Request ID
   * @returns {Promise<Object|null>} Fixed deposit request or null
   */
  getById: async (id) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM fixed_deposit_requests WHERE id = ?',
        [id]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting fixed deposit request by ID:', error);
      throw error;
    }
  },

  /**
   * Get a fixed deposit request by request number
   * @param {string} requestNo - Request number
   * @returns {Promise<Object|null>} Fixed deposit request or null
   */
  getByRequestNo: async (requestNo) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM fixed_deposit_requests WHERE request_no = ?',
        [requestNo]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting fixed deposit request by request number:', error);
      throw error;
    }
  },

  /**
   * Create a new fixed deposit request
   * @param {Object} data - Fixed deposit request data
   * @returns {Promise<Object>} Created request with insertId
   */
  create: async (data) => {
    try {
      const sql = `INSERT INTO fixed_deposit_requests (
        portfolio_id, book, module, request_no, file_number, status,
        counterparty_type, counterparty_id, contact_person, request_remarks,
        instrument_type, isin, currency, requested_amount, target_yield,
        value_date, maturity_date,
        approver_id, approver_name, approver_designation, approval_category,
        approval_limit_required, approver_notes,
        submitted_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;

      const values = [
        data.portfolio_id || null,
        data.book || null,
        data.module || 'Pre approval',
        data.request_no,
        data.file_number || null,
        data.status || 'Draft',
        data.counterparty_type || 'Bank',
        data.counterparty_id || null,
        data.contact_person || null,
        data.request_remarks || null,
        data.instrument_type || null,
        data.isin || null,
        data.currency || 'LKR',
        data.requested_amount ? parseFloat(data.requested_amount) : null,
        data.target_yield ? parseFloat(data.target_yield) : null,
        data.value_date || null,
        data.maturity_date || null,
        data.approver_id || null,
        data.approver_name || null,
        data.approver_designation || null,
        data.approval_category || null,
        data.approval_limit_required || null,
        data.approver_notes || null,
        data.submitted_by || null
      ];

      const [result] = await db.query(sql, values);
      return { id: result.insertId, ...data };
    } catch (error) {
      console.error('Error creating fixed deposit request:', error);
      throw error;
    }
  },

  /**
   * Update a fixed deposit request
   * @param {number} id - Request ID
   * @param {Object} data - Updated data
   * @returns {Promise<Object>} Updated request
   */
  update: async (id, data) => {
    try {
      const updateFields = [];
      const values = [];

      // Build dynamic update query
      const fields = [
        'portfolio_id', 'book', 'module', 'request_no', 'file_number', 'status',
        'counterparty_type', 'counterparty_id', 'contact_person', 'request_remarks',
        'instrument_type', 'isin', 'currency', 'requested_amount', 'target_yield',
        'value_date', 'maturity_date',
        'approver_id', 'approver_name', 'approver_designation', 'approval_category',
        'approval_limit_required', 'approver_notes'
      ];

      fields.forEach(field => {
        if (data.hasOwnProperty(field)) {
          updateFields.push(`${field} = ?`);
          if (field === 'requested_amount' || field === 'target_yield') {
            values.push(data[field] ? parseFloat(data[field]) : null);
          } else {
            values.push(data[field] || null);
          }
        }
      });

      if (updateFields.length === 0) {
        throw new Error('No fields to update');
      }

      updateFields.push('updated_at = NOW()');
      values.push(id);

      const sql = `UPDATE fixed_deposit_requests SET ${updateFields.join(', ')} WHERE id = ?`;
      await db.query(sql, values);

      return { success: true, id };
    } catch (error) {
      console.error('Error updating fixed deposit request:', error);
      throw error;
    }
  },

  /**
   * Delete a fixed deposit request
   * @param {number} id - Request ID
   * @returns {Promise<Object>} Success status
   */
  delete: async (id) => {
    try {
      await db.query('DELETE FROM fixed_deposit_requests WHERE id = ?', [id]);
      return { success: true };
    } catch (error) {
      console.error('Error deleting fixed deposit request:', error);
      throw error;
    }
  },

  /**
   * Approve a fixed deposit request
   * @param {number} id - Request ID
   * @param {number} approvedBy - User ID who approved
   * @param {string} approverNotes - Optional notes
   * @returns {Promise<Object>} Updated request
   */
  approve: async (id, approvedBy, approverNotes = null) => {
    try {
      await db.query(
        `UPDATE fixed_deposit_requests 
         SET status = 'Approved',
             approved_by = ?,
             approver_notes = ?,
             approved_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [approvedBy, approverNotes, id]
      );
      return { success: true, id };
    } catch (error) {
      console.error('Error approving fixed deposit request:', error);
      throw error;
    }
  },

  /**
   * Reject a fixed deposit request
   * @param {number} id - Request ID
   * @param {number} rejectedBy - User ID who rejected
   * @param {string} approverNotes - Optional notes
   * @returns {Promise<Object>} Updated request
   */
  reject: async (id, rejectedBy, approverNotes = null) => {
    try {
      await db.query(
        `UPDATE fixed_deposit_requests 
         SET status = 'Rejected',
             rejected_by = ?,
             approver_notes = ?,
             rejected_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [rejectedBy, approverNotes, id]
      );
      return { success: true, id };
    } catch (error) {
      console.error('Error rejecting fixed deposit request:', error);
      throw error;
    }
  },

  /**
   * Submit a fixed deposit request for approval
   * @param {number} id - Request ID
   * @param {number} submittedBy - User ID who submitted
   * @returns {Promise<Object>} Updated request
   */
  submitForApproval: async (id, submittedBy) => {
    try {
      await db.query(
        `UPDATE fixed_deposit_requests 
         SET status = 'Pending',
             submitted_by = ?,
             submitted_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [submittedBy, id]
      );
      return { success: true, id };
    } catch (error) {
      console.error('Error submitting fixed deposit request for approval:', error);
      throw error;
    }
  },

  /**
   * Get next request number sequence for a given date
   * @param {string} dateStr - Date string in YYYYMMDD format
   * @returns {Promise<number>} Next sequence number
   */
  getNextRequestNumber: async (dateStr) => {
    try {
      const prefix = `FD${dateStr}`;
      const [rows] = await db.query(
        `SELECT request_no FROM fixed_deposit_requests 
         WHERE request_no LIKE ? 
         ORDER BY request_no DESC 
         LIMIT 1`,
        [`${prefix}%`]
      );

      if (rows.length === 0) {
        return 1;
      }

      const lastRequestNo = rows[0].request_no;
      const lastSequence = parseInt(lastRequestNo.substring(10)) || 0;
      return lastSequence + 1;
    } catch (error) {
      console.error('Error getting next request number:', error);
      throw error;
    }
  }
};

module.exports = FixedDepositRequest;
