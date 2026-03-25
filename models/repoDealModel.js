const db = require('../config/db');
const CashflowCaptureService = require('../services/cashflowCaptureService');

const ensureRepoDealColumns = async () => {
  const requiredColumns = {
    face_value_adjustment: 'DECIMAL(20,4) NULL',
    face_value_as_per_counterparty: 'DECIMAL(20,4) NULL'
  };

  const columnNames = Object.keys(requiredColumns);
  const placeholders = columnNames.map(() => '?').join(', ');
  const [rows] = await db.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'repo_deals'
        AND COLUMN_NAME IN (${placeholders})`,
    columnNames
  );
  const present = new Set((rows || []).map((r) => r.COLUMN_NAME));

  for (const columnName of columnNames) {
    if (present.has(columnName)) continue;
    await db.query(`ALTER TABLE repo_deals ADD COLUMN ${columnName} ${requiredColumns[columnName]}`);
  }
};

const RepoDeal = {
  // Create a new repo deal
  create: async (dealData) => {
    try {
      await ensureRepoDealColumns();

      const counterpartyId =
        dealData.counterparty !== undefined && dealData.counterparty !== null && dealData.counterparty !== ''
          ? parseInt(dealData.counterparty, 10)
          : null;

      const sql = `
         INSERT INTO repo_deals (
           deal_type, counterparty_id, settlement_mode, trade_date, value_date, maturity_date,
           principal_amount, interest_amount, rate, maturity_amount, tenor,
           calculation_day_basis, isin_number, issue_date, haircut, face_value, face_value_adjustment, face_value_as_per_counterparty,
           status, approval_status, current_approval_level, comment, authorized_by, authorized_at, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       `;
       
       const values = [
         dealData.dealType,
         counterpartyId,
         dealData.settlementMode || null,
         dealData.tradeDate,
        dealData.valueDate,
        dealData.maturityDate,
        dealData.principalAmount,
        dealData.interestAmount,
        dealData.rate,
        dealData.maturityAmount,
        dealData.tenor,
        dealData.calculationDayBasis,
        dealData.isin,
        dealData.issueDate,
        dealData.haircut || 0,
        dealData.faceValue || null,
        dealData.faceValueAdjustment || 0,
        dealData.faceValueAsPerCounterparty || null,
        dealData.status || 'Pending',
        dealData.approvalStatus || 'pending',
        dealData.currentApprovalLevel || 'front_office',
        dealData.comment || null,
        dealData.authorizedBy || null,
        dealData.authorizedAt || null,
        dealData.createdBy
      ];

      const [result] = await db.query(sql, values);

      // Insert ISIN rows into child table if provided
      const selectedIsins = Array.isArray(dealData.isins) ? dealData.isins : [];
      const isinsToInsert = selectedIsins.length > 0
        ? selectedIsins
        : (dealData.isin ? [{ isin: dealData.isin, faceValue: dealData.faceValue }] : []);

      if (isinsToInsert.length > 0) {
        const filteredIsins = isinsToInsert.filter(i => i && (i.isin || i.isin_number));
        if (filteredIsins.length > 0) {
          const placeholders = filteredIsins.map(() => '(?, ?, ?)').join(', ');
          const flatValues = filteredIsins.flatMap(i => [
            result.insertId,
            (i.isin || i.isin_number),
            i.faceValue != null ? i.faceValue : null
          ]);
          const insertChildSql = `
            INSERT INTO repo_deal_isins (repo_deal_id, isin_number, face_value)
            VALUES ${placeholders}
          `;
          await db.query(insertChildSql, flatValues);
        }
      }
      
      // Capture cashflow for the new repo deal
      try {
        await CashflowCaptureService.captureRepoCashflow(
          result.insertId,
          dealData.dealType,
          dealData.principalAmount,
          dealData.tradeDate,
          dealData.counterparty
        );
      } catch (cashflowError) {
        console.error('Error capturing cashflow for repo deal:', cashflowError);
        // Don't fail the main process if cashflow capture fails
      }
      
      return { id: result.insertId, ...dealData };
    } catch (error) {
      console.error('Error creating repo deal:', error);
      throw error;
    }
  },

  // Get all repo deals with optional filters
  getAll: async (filters = {}) => {
    try {
            let sql = `
         SELECT 
           rd.*,
           COALESCE(
             corp.short_name, 
             ind.short_name, 
             joint.short_name
           ) as counterparty_name,
           COALESCE(
             corp.long_name, 
             ind.long_name, 
             joint.long_name
           ) as counterparty_long_name,
           u.username as created_by_name
         FROM repo_deals rd
         LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
         LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
         LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
         LEFT JOIN users u ON rd.created_by = u.id
         WHERE 1=1
       `;
      
      const values = [];
      
      if (filters.dealType) {
        sql += ' AND rd.deal_type = ?';
        values.push(filters.dealType);
      }
      
      if (filters.status) {
        sql += ' AND rd.status = ?';
        values.push(filters.status);
      }
      
      if (filters.counterpartyId) {
        sql += ' AND rd.counterparty_id = ?';
        values.push(filters.counterpartyId);
      }
      
      if (filters.startDate) {
        sql += ' AND rd.trade_date >= ?';
        values.push(filters.startDate);
      }
      
      if (filters.endDate) {
        sql += ' AND rd.trade_date <= ?';
        values.push(filters.endDate);
      }
      
      sql += ' ORDER BY rd.created_at DESC';
      
      const [results] = await db.query(sql, values);

      if (results.length === 0) return results;

      // Load isins for all deals in one query
      const dealIds = results.map(r => r.id);
      const [isinRows] = await db.query(
        `SELECT repo_deal_id, isin_number, face_value FROM repo_deal_isins WHERE repo_deal_id IN (${dealIds.map(() => '?').join(',')})`,
        dealIds
      );
      const byDealId = new Map();
      for (const row of isinRows) {
        const arr = byDealId.get(row.repo_deal_id) || [];
        arr.push({ isin: row.isin_number, faceValue: row.face_value });
        byDealId.set(row.repo_deal_id, arr);
      }
      return results.map(r => ({ ...r, isins: byDealId.get(r.id) || [] }));
    } catch (error) {
      console.error('Error fetching repo deals:', error);
      throw error;
    }
  },

  // Get repo deal by ID
  getById: async (id) => {
    try {
            const sql = `
         SELECT 
           rd.*,
           COALESCE(
             corp.short_name, 
             ind.short_name, 
             joint.short_name
           ) as counterparty_name,
           COALESCE(
             corp.long_name, 
             ind.long_name, 
             joint.long_name
           ) as counterparty_long_name,
           u.username as created_by_name
         FROM repo_deals rd
         LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
         LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
         LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
         LEFT JOIN users u ON rd.created_by = u.id
         WHERE rd.id = ?
       `;
      
      const [results] = await db.query(sql, [id]);
      const deal = results[0] || null;
      if (!deal) return null;
      const [rows] = await db.query(
        'SELECT isin_number, face_value FROM repo_deal_isins WHERE repo_deal_id = ?',
        [id]
      );
      return { ...deal, isins: rows.map(r => ({ isin: r.isin_number, faceValue: r.face_value })) };
    } catch (error) {
      console.error('Error fetching repo deal by ID:', error);
      throw error;
    }
  },

  // Update repo deal
  update: async (id, updateData) => {
    try {
      await ensureRepoDealColumns();

             const allowedFields = [
         'deal_type', 'counterparty_id', 'trade_date', 'value_date', 'maturity_date',
         'principal_amount', 'interest_amount', 'rate', 'maturity_amount', 'tenor',
         'calculation_day_basis', 'isin_number', 'issue_date', 'haircut', 'face_value',
         'face_value_adjustment', 'face_value_as_per_counterparty',
         'status', 'approval_status', 'current_approval_level', 'comment', 'settlement_mode'
       ];
      
      const updates = [];
      const values = [];
      
      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key) && value !== undefined) {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
      
      if (updates.length === 0) {
        throw new Error('No valid fields to update');
      }
      
      values.push(id);
      
      const sql = `UPDATE repo_deals SET ${updates.join(', ')} WHERE id = ?`;
      const [result] = await db.query(sql, values);
      
      if (result.affectedRows === 0) {
        throw new Error('Repo deal not found');
      }
      
      return { id, ...updateData };
    } catch (error) {
      console.error('Error updating repo deal:', error);
      throw error;
    }
  },

  // Delete repo deal
  delete: async (id) => {
    try {
      const sql = 'DELETE FROM repo_deals WHERE id = ?';
      const [result] = await db.query(sql, [id]);
      
      if (result.affectedRows === 0) {
        throw new Error('Repo deal not found');
      }
      
      return { id, deleted: true };
    } catch (error) {
      console.error('Error deleting repo deal:', error);
      throw error;
    }
  },

  // Get repo deals by counterparty
  getByCounterparty: async (counterpartyId) => {
    try {
      const sql = `
        SELECT * FROM repo_deals 
        WHERE counterparty_id = ? 
        ORDER BY created_at DESC
      `;
      
      const [results] = await db.query(sql, [counterpartyId]);
      return results;
    } catch (error) {
      console.error('Error fetching repo deals by counterparty:', error);
      throw error;
    }
  },

  // Get repo deals by ISIN
  getByIsin: async (isinNumber) => {
    try {
      // Match either legacy column or child table
      const [results] = await db.query(
        `SELECT rd.*
         FROM repo_deals rd
         LEFT JOIN repo_deal_isins rdi ON rdi.repo_deal_id = rd.id
         WHERE rd.isin_number = ? OR rdi.isin_number = ?
         GROUP BY rd.id
         ORDER BY rd.created_at DESC`,
        [isinNumber, isinNumber]
      );

      if (results.length === 0) return results;

      const dealIds = results.map(r => r.id);
      const [isinRows] = await db.query(
        `SELECT repo_deal_id, isin_number, face_value FROM repo_deal_isins WHERE repo_deal_id IN (${dealIds.map(() => '?').join(',')})`,
        dealIds
      );
      const byDealId = new Map();
      for (const row of isinRows) {
        const arr = byDealId.get(row.repo_deal_id) || [];
        arr.push({ isin: row.isin_number, faceValue: row.face_value });
        byDealId.set(row.repo_deal_id, arr);
      }
      return results.map(r => ({ ...r, isins: byDealId.get(r.id) || [] }));
    } catch (error) {
      console.error('Error fetching repo deals by ISIN:', error);
      throw error;
    }
  },

  // Get active repo deals
  getActive: async () => {
    try {
      const sql = `
        SELECT * FROM repo_deals 
        WHERE status = 'Active' 
        ORDER BY maturity_date ASC
      `;
      
      const [results] = await db.query(sql);
      return results;
    } catch (error) {
      console.error('Error fetching active repo deals:', error);
      throw error;
    }
  },

  // Get repo deals expiring soon (within specified days)
  getExpiringSoon: async (days = 7) => {
    try {
      const sql = `
        SELECT * FROM repo_deals 
        WHERE status = 'Active' 
        AND maturity_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        ORDER BY maturity_date ASC
      `;
      
      const [results] = await db.query(sql, [days]);
      return results;
    } catch (error) {
      console.error('Error fetching expiring repo deals:', error);
      throw error;
    }
  },

  // Update status of repo deal
  updateStatus: async (id, status) => {
    try {
      const sql = 'UPDATE repo_deals SET status = ? WHERE id = ?';
      const [result] = await db.query(sql, [status, id]);
      
      if (result.affectedRows === 0) {
        throw new Error('Repo deal not found');
      }
      
      return { id, status };
    } catch (error) {
      console.error('Error updating repo deal status:', error);
      throw error;
    }
  },

  updateApprovalStatus: async (id, { action, comment, userId }) => {
    // Schema-aware: repo deals might exist before the approval migration ran.
    const approvalColumns = [
      'approval_status',
      'current_approval_level',
      'comment',
      'authorized_by',
      'authorized_at'
    ];

    const placeholders = approvalColumns.map(() => '?').join(', ');
    const [presentColsRows] = await db.query(
      `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'repo_deals'
          AND COLUMN_NAME IN (${placeholders})`,
      approvalColumns
    );

    const present = new Set((presentColsRows || []).map(r => r.COLUMN_NAME));

    // Ensure required columns exist (so approvals won't hard-fail before migration runs)
    const columnDefinitions = {
      approval_status: 'VARCHAR(32) NULL',
      current_approval_level: 'VARCHAR(32) NULL',
      comment: 'TEXT NULL',
      authorized_by: 'INT NULL',
      authorized_at: 'DATETIME NULL'
    };

    const shouldEnsureAll = !present.has('approval_status') && !present.has('current_approval_level');
    const shouldEnsureAny = shouldEnsureAll || !present.has('comment') || !present.has('authorized_by') || !present.has('authorized_at');

    if (shouldEnsureAny) {
      for (const col of approvalColumns) {
        if (!present.has(col)) {
          const def = columnDefinitions[col];
          if (!def) continue;
          await db.query(`ALTER TABLE repo_deals ADD COLUMN ${col} ${def}`);
        }
      }
    }

    // Re-check after potential ALTER TABLE
    const [presentColsRows2] = await db.query(
      `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'repo_deals'
          AND COLUMN_NAME IN (${placeholders})`,
      approvalColumns
    );
    const present2 = new Set((presentColsRows2 || []).map(r => r.COLUMN_NAME));

    const hasApprovalStatus = present2.has('approval_status');
    const hasCurrentApprovalLevel = present2.has('current_approval_level');

    const selectParts = [];
    if (hasApprovalStatus) selectParts.push('approval_status');
    if (hasCurrentApprovalLevel) selectParts.push('current_approval_level');

    const sqlSelect = `SELECT ${selectParts.join(', ')} FROM repo_deals WHERE id = ?`;
    const [rows] = await db.query(sqlSelect, [id]);
    if (!rows || rows.length === 0) throw new Error('Repo deal not found');

    const row = rows[0];

    const currentLevel = hasCurrentApprovalLevel ? (row.current_approval_level || 'front_office') : 'front_office';
    const currentApprovalStatus = hasApprovalStatus ? (row.approval_status || 'pending') : 'pending';

    let newApprovalStatus = currentApprovalStatus;
    let newApprovalLevel = currentLevel;

    if (action === 'approved') {
      if (currentLevel === 'front_office') {
        newApprovalLevel = 'back_office_verifier';
        newApprovalStatus = 'pending';
      } else if (currentLevel === 'back_office_verifier') {
        newApprovalLevel = 'back_office_final';
        newApprovalStatus = 'pending';
      } else if (currentLevel === 'back_office_final') {
        newApprovalLevel = 'final_approved';
        newApprovalStatus = 'final_approved';
      }
    } else if (action === 'rejected') {
      newApprovalLevel = 'rejected';
      newApprovalStatus = 'rejected';
    } else {
      throw new Error('Invalid approval action');
    }

    const authorizedAt = new Date();
    const setClauses = [];
    const values = [];

    if (hasApprovalStatus) {
      setClauses.push('approval_status = ?');
      values.push(newApprovalStatus);
    }
    if (hasCurrentApprovalLevel) {
      setClauses.push('current_approval_level = ?');
      values.push(newApprovalLevel);
    }
    if (present2.has('comment')) {
      setClauses.push('comment = ?');
      values.push(comment || null);
    }
    if (present2.has('authorized_by')) {
      setClauses.push('authorized_by = ?');
      values.push(userId || null);
    }
    if (present2.has('authorized_at')) {
      setClauses.push('authorized_at = ?');
      values.push(authorizedAt);
    }

    if (setClauses.length === 0) {
      throw new Error('No approval fields available to update on repo_deals.');
    }

    values.push(id);

    const sqlUpdate = `UPDATE repo_deals SET ${setClauses.join(', ')} WHERE id = ?`;
    await db.query(sqlUpdate, values);

    return {
      id,
      approval_status: hasApprovalStatus ? newApprovalStatus : undefined,
      current_approval_level: hasCurrentApprovalLevel ? newApprovalLevel : undefined
    };
  },

  // Get summary statistics
  getSummary: async () => {
    try {
      const sql = `
        SELECT 
          COUNT(*) as total_deals,
          COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_deals,
          COUNT(CASE WHEN status = 'Matured' THEN 1 END) as matured_deals,
          COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_deals,
          SUM(CASE WHEN status = 'Active' THEN principal_amount ELSE 0 END) as total_principal,
          SUM(CASE WHEN status = 'Active' THEN interest_amount ELSE 0 END) as total_interest,
          AVG(CASE WHEN status = 'Active' THEN rate ELSE NULL END) as avg_rate
        FROM repo_deals
      `;
      
      const [results] = await db.query(sql);
      return results[0];
    } catch (error) {
      console.error('Error fetching repo deals summary:', error);
      throw error;
    }
  },

  // Get repo deals maturing by date
  getMaturitiesByDate: async (date) => {
    try {
      const query = `
        SELECT 
          rd.id,
          rd.id as deal_number,
          rd.counterparty_id,
          COALESCE(
            corp.short_name,
            ind.short_name,
            joint.short_name,
            rd.counterparty_id
          ) as counterparty_name,
          rd.principal_amount,
          rd.interest_amount,
          rd.maturity_amount,
          rd.rate,
          rd.maturity_date,
          rd.status as deal_status,
          DATEDIFF(rd.maturity_date, CURDATE()) as days_to_maturity
        FROM repo_deals rd
        LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
        WHERE rd.maturity_date <= ?
          AND COALESCE(rd.matured, 0) = 0
        ORDER BY rd.maturity_date ASC
      `;
      
      const [rows] = await db.query(query, [date]);
      return rows;
    } catch (error) {
      console.error('Error fetching repo maturities by date:', error);
      throw error;
    }
  }
};

module.exports = RepoDeal;
