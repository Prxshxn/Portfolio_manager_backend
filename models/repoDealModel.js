const db = require('../config/db');
const CashflowCaptureService = require('../services/cashflowCaptureService');

let repoApprovalColumnsEnsurePromise = null;

// Standalone ensure, used by callers (e.g. the daily blotter) that need the
// per-tier approver columns to exist before SELECTing them, without going
// through a full updateApprovalStatus() call.
const ensureRepoApprovalColumns = async () => {
  if (!repoApprovalColumnsEnsurePromise) {
    repoApprovalColumnsEnsurePromise = (async () => {
      const requiredColumns = {
        front_office_by: 'INT NULL',
        back_office_verifier_by: 'INT NULL',
        final_approved_by: 'INT NULL'
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
    })().catch((err) => {
      repoApprovalColumnsEnsurePromise = null;
      throw err;
    });
  }
  return repoApprovalColumnsEnsurePromise;
};

const parseCounterpartyId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m = s.match(/^[a-zA-Z]+(\d+)$/);
  if (m && m[1]) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const any = s.match(/\d+/);
  if (any && any[0]) {
    const n = parseInt(any[0], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

function formatValueDateKey(valueDate) {
  const d = valueDate instanceof Date ? valueDate : new Date(valueDate);
  if (Number.isNaN(d.getTime())) return null;
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

function getDealTypePrefix(dealType) {
  return String(dealType || '').toLowerCase().includes('reverse') ? 'RVREPO' : 'REPO';
}

function resolveRepoDealNumber(deal) {
  if (!deal) return '';
  const dn = deal.deal_number || deal.dealNumber;
  if (dn && String(dn).trim()) return String(dn).trim();
  return deal.id != null ? String(deal.id) : '';
}

function hasRepoDealNumber(value) {
  return Boolean(value && String(value).trim());
}

const ensureRepoDealColumns = async () => {
  const requiredColumns = {
    face_value_adjustment: 'DECIMAL(20,4) NULL',
    face_value_as_per_counterparty: 'DECIMAL(20,4) NULL',
    fund_movement: "VARCHAR(10) NULL DEFAULT 'no'"
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
    const MAX_ATTEMPTS = 5;
    let attempt = 0;
    let lastError;

    while (attempt < MAX_ATTEMPTS) {
      try {
        await ensureRepoDealColumns();

        const counterpartyId = parseCounterpartyId(dealData.counterparty);

        // Calculate daily_accrual: interestAmount / tenor (truncated to 8 decimals)
        let dailyAccrual = null;
        const interestAmt = parseFloat(dealData.interestAmount);
        const tenorVal = parseFloat(dealData.tenor);
        if (interestAmt && tenorVal && tenorVal > 0) {
          dailyAccrual = Math.floor((interestAmt / tenorVal) * 100000000) / 100000000;
        }

        if (!hasRepoDealNumber(dealData.dealNumber) && dealData.valueDate) {
          dealData.dealNumber = await RepoDeal.generateNextDealNumber(dealData.valueDate, dealData.dealType);
        }
        if (!hasRepoDealNumber(dealData.dealNumber)) {
          throw new Error('Could not generate repo deal_number (value date and deal type are required)');
        }

        const sql = `
         INSERT INTO repo_deals (
           deal_number, deal_type, counterparty_id, settlement_mode, trade_date, value_date, maturity_date,
           principal_amount, interest_amount, rate, maturity_amount, tenor,
           calculation_day_basis, isin_number, issue_date, haircut, face_value, face_value_adjustment, face_value_as_per_counterparty,
           fund_movement, status, approval_status, current_approval_level, comment, authorized_by, authorized_at, created_by,
           daily_accrual
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       `;

        const values = [
          dealData.dealNumber,
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
          String(dealData.fundMovement || 'no').toLowerCase() === 'yes' ? 'yes' : 'no',
          dealData.status || 'Pending',
          dealData.approvalStatus || 'pending',
          dealData.currentApprovalLevel || 'front_office',
          dealData.comment || null,
          dealData.authorizedBy || null,
          dealData.authorizedAt || null,
          dealData.createdBy,
          dailyAccrual
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
            dealData.dealNumber,
            dealData.dealType,
            dealData.principalAmount,
            dealData.tradeDate,
            dealData.counterparty
          );
        } catch (cashflowError) {
          console.error('Error capturing cashflow for repo deal:', cashflowError);
        }

        return {
          id: result.insertId,
          deal_number: dealData.dealNumber,
          dealNumber: dealData.dealNumber,
          ...dealData
        };
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' && String(error.sqlMessage || '').includes('unique_repo_deal_number')) {
          attempt++;
          dealData.dealNumber = null;
          lastError = error;
          continue;
        }
        console.error('Error creating repo deal:', error);
        throw error;
      }
    }

    throw lastError || new Error('Failed to generate unique repo deal number after retries');
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
      const withIsins = results.map(r => ({ ...r, isins: byDealId.get(r.id) || [] }));
      for (const deal of withIsins) {
        if (!hasRepoDealNumber(deal.deal_number)) {
          await RepoDeal.assignDealNumberIfMissing(deal);
        }
      }
      return withIsins;
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
      if (!hasRepoDealNumber(deal.deal_number)) {
        await RepoDeal.assignDealNumberIfMissing(deal);
      }
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
         'status', 'approval_status', 'current_approval_level', 'comment', 'settlement_mode',
         'daily_accrual', 'fund_movement'
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
      'authorized_at',
      'front_office_by',
      'back_office_verifier_by',
      'final_approved_by'
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
      authorized_at: 'DATETIME NULL',
      front_office_by: 'INT NULL',
      back_office_verifier_by: 'INT NULL',
      final_approved_by: 'INT NULL'
    };

    const shouldEnsureAll = !present.has('approval_status') && !present.has('current_approval_level');
    const shouldEnsureAny = shouldEnsureAll
      || !present.has('comment')
      || !present.has('authorized_by')
      || !present.has('authorized_at')
      || !present.has('front_office_by')
      || !present.has('back_office_verifier_by')
      || !present.has('final_approved_by');

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
    // Which approver-tracking column to stamp with userId, keyed by the tier
    // being completed (i.e. the level before this transition).
    let approverColumn = null;

    if (action === 'approved') {
      if (currentLevel === 'front_office') {
        newApprovalLevel = 'back_office_verifier';
        newApprovalStatus = 'pending';
        approverColumn = 'front_office_by';
      } else if (currentLevel === 'back_office_verifier') {
        newApprovalLevel = 'back_office_final';
        newApprovalStatus = 'pending';
        approverColumn = 'back_office_verifier_by';
      } else if (currentLevel === 'back_office_final') {
        newApprovalLevel = 'final_approved';
        newApprovalStatus = 'final_approved';
        approverColumn = 'final_approved_by';
      }
    } else if (action === 'rejected') {
      // Send rejected repo deals back to the front office checker queue so the
      // originator can fix and resubmit. The 'rejected' status is preserved
      // so the front-office blotter can flag the row visually.
      newApprovalLevel = 'front_office';
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
    if (approverColumn && present2.has(approverColumn) && userId != null) {
      setClauses.push(`${approverColumn} = ?`);
      values.push(userId);
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
          rd.deal_number,
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
  },

  /**
   * Backfill purchase ledger entries for final_approved Repo deals that are missing them.
   * Optionally pass a single dealId to backfill just that deal.
   */
  backfillLedgerEntries: async (dealId = null) => {
    try {
      const ledgerController = require('../controllers/ledgerController');
      const accountMapping = require('../services/accountMappingService');

      let query = `
        SELECT rd.*
        FROM repo_deals rd
        WHERE rd.approval_status = 'final_approved'
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries le WHERE le.deal_number = rd.deal_number
          )
      `;
      const params = [];
      if (dealId) {
        query += ' AND rd.id = ?';
        params.push(dealId);
      }

      const [deals] = await db.query(query, params);

      if (deals.length === 0) {
        return {
          success: true,
          message: dealId
            ? 'Deal already has ledger entries or is not final_approved'
            : 'No deals found that need ledger entries',
          processed: 0
        };
      }

      let processed = 0;
      const errors = [];

      for (const deal of deals) {
        try {
          // Resolve settlement bank account (used for both Repo and Reverse Repo)
          let bankAccount = null;
          if (deal.settlement_mode) {
            const [sa] = await db.query(
              'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
              [deal.settlement_mode]
            );
            if (sa && sa.length > 0 && sa[0].ledger_account_code) {
              bankAccount = sa[0].ledger_account_code;
            }
          }

          if (!bankAccount) {
            errors.push(`Deal ${resolveRepoDealNumber(deal)}: no settlement bank account resolved for settlement_mode=${deal.settlement_mode}`);
            continue;
          }

          const valueDate = deal.value_date
            ? new Date(deal.value_date).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);

          let drAccount;
          let crAccount;
          let description;

          if (deal.deal_type === 'Reverse Repo') {
            // Reverse Repo (Sherwood lends, asset side): DR Reverse Repo asset, CR Bank
            drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET);
            crAccount = bankAccount;
            description = `Reverse Repo Purchase (Backfill) - Deal ${resolveRepoDealNumber(deal)}`;
          } else if (deal.deal_type === 'Repo') {
            // Repo (Sherwood borrows): DR Bank, CR Repo liability
            drAccount = bankAccount;
            crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY);
            description = `Repo Borrowing (Backfill) - Deal ${resolveRepoDealNumber(deal)}`;
          } else {
            // Unknown type - skip
            errors.push(`Deal ${resolveRepoDealNumber(deal)}: unsupported deal_type=${deal.deal_type} for backfill`);
            continue;
          }

          const result = await ledgerController.postLedgerEntry({
            date: valueDate,
            dr_account: drAccount,
            cr_account: crAccount,
            amount: Number(deal.principal_amount),
            deal_id: resolveRepoDealNumber(deal),
            description
          });

          if (result.success) {
            processed++;
          } else {
            errors.push(`Deal ${resolveRepoDealNumber(deal)}: ${result.error}`);
          }
        } catch (err) {
          errors.push(`Deal ${resolveRepoDealNumber(deal)}: ${err.message}`);
        }
      }

      return {
        success: true,
        message: `Backfilled ${processed} of ${deals.length} Repo deals`,
        processed,
        total: deals.length,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      console.error('Error backfilling repo ledger entries:', error);
      throw error;
    }
  }
};

RepoDeal.getLatestDealNumber = async (dateStr, prefix) => {
  const [results] = await db.query(
    'SELECT deal_number FROM repo_deals WHERE deal_number LIKE ? ORDER BY deal_number DESC LIMIT 1',
    [`${dateStr}/${prefix}/%`]
  );
  return results[0] ? results[0].deal_number : null;
};

RepoDeal.generateNextDealNumber = async (valueDate, dealType) => {
  const dateStr = formatValueDateKey(valueDate);
  if (!dateStr) {
    throw new Error('Invalid value date for repo deal number generation');
  }
  const prefix = getDealTypePrefix(dealType);
  try {
    const latest = await RepoDeal.getLatestDealNumber(dateStr, prefix);
    let nextSeq = 1;
    if (latest) {
      const parts = latest.split('/');
      if (parts.length >= 3) {
        const seqNum = parseInt(parts[2], 10);
        if (!Number.isNaN(seqNum)) nextSeq = seqNum + 1;
      }
    }
    return `${dateStr}/${prefix}/${String(nextSeq).padStart(4, '0')}`;
  } catch (error) {
    console.error('[ERROR] Failed to generate repo deal number:', error);
    const timestamp = Date.now().toString().slice(-4);
    return `${dateStr}/${prefix}/${timestamp}`;
  }
};

/** Assign deal_number when missing (e.g. deal created before server restart). */
RepoDeal.assignDealNumberIfMissing = async (deal) => {
  if (!deal || !deal.id) return deal;
  if (hasRepoDealNumber(deal.deal_number)) return deal;
  const dealNumber = await RepoDeal.generateNextDealNumber(deal.value_date, deal.deal_type);
  await db.query('UPDATE repo_deals SET deal_number = ? WHERE id = ?', [dealNumber, deal.id]);
  deal.deal_number = dealNumber;
  deal.dealNumber = dealNumber;
  return deal;
};

RepoDeal.backfillMissingDealNumbers = async () => {
  const [rows] = await db.query(
    `SELECT id, deal_type, value_date, deal_number
       FROM repo_deals
      WHERE deal_number IS NULL OR TRIM(deal_number) = ''
      ORDER BY value_date ASC, id ASC`
  );
  for (const deal of rows) {
    await RepoDeal.assignDealNumberIfMissing(deal);
  }
  return { processed: rows.length };
};

module.exports = RepoDeal;
module.exports.resolveRepoDealNumber = resolveRepoDealNumber;
module.exports.ensureApprovalColumns = ensureRepoApprovalColumns;
