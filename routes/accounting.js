const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');

/** Resolve pseudo chart rows (e.g. GSEC_ACCRUAL_INCOME_, GSEC_ACCRUAL_ASSET_C) via account_mappings. */
const LEDGER_ACCOUNT_MAPPING_JOIN = `
      LEFT JOIN account_mappings am ON am.is_active = TRUE
        AND (
          am.mapping_key = coa.account_code
          OR am.mapping_key = TRIM(TRAILING '_' FROM coa.account_code)
          OR coa.account_code REGEXP CONCAT('^', am.mapping_key, '_.*$')
        )
      LEFT JOIN chart_of_accounts coa_resolved
        ON coa_resolved.account_code = am.account_code AND coa_resolved.is_active = TRUE`;

// Get all account types
router.get('/account-types', auth, async (req, res) => {
  try {
    const [accountTypes] = await db.query(`
      SELECT * FROM account_types
      ORDER BY category, name
    `);
    res.json(accountTypes);
  } catch (error) {
    console.error('Error fetching account types:', error);
    res.status(500).json({ error: 'Failed to fetch account types' });
  }
});

// Get chart of accounts (with optional filtering)
router.get('/chart-of-accounts', auth, async (req, res) => {
  try {
    const { accountTypeId, category, isActive, parentAccountId } = req.query;
    
    let query = `
      SELECT coa.*, at.name as account_type_name, at.category, 
             p.name as parent_account_name
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN chart_of_accounts p ON coa.parent_account_id = p.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (accountTypeId) {
      query += ` AND coa.account_type_id = ?`;
      params.push(accountTypeId);
    }
    
    if (category) {
      query += ` AND at.category = ?`;
      params.push(category);
    }
    
    if (isActive !== undefined) {
      query += ` AND coa.is_active = ?`;
      params.push(isActive === 'true' || isActive === '1');
    }
    
    if (parentAccountId) {
      if (parentAccountId === 'null') {
        query += ` AND coa.parent_account_id IS NULL`;
      } else {
        query += ` AND coa.parent_account_id = ?`;
        params.push(parentAccountId);
      }
    }
    
    query += ` ORDER BY coa.account_code`;
    
    const [accounts] = await db.query(query, params);
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching chart of accounts:', error);
    res.status(500).json({ error: 'Failed to fetch chart of accounts' });
  }
});

// Create a new account
router.post('/chart-of-accounts', auth, async (req, res) => {
  try {
    const { 
      account_code, 
      name, 
      account_type_id, 
      parent_account_id, 
      description, 
      is_active 
    } = req.body;
    
    // Validate required fields
    if (!account_code || !name || !account_type_id) {
      return res.status(400).json({ error: 'Account code, name, and type are required' });
    }
    
    // Check if account code already exists
    const [existingAccounts] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ?', 
      [account_code]
    );
    
    if (existingAccounts.length > 0) {
      return res.status(400).json({ error: 'Account code already exists' });
    }
    
    // Insert new account
    const [result] = await db.query(
      `INSERT INTO chart_of_accounts 
       (account_code, name, account_type_id, parent_account_id, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        account_code, 
        name, 
        account_type_id, 
        parent_account_id || null, 
        description || null, 
        is_active !== undefined ? is_active : true
      ]
    );
    
    res.status(201).json({ 
      id: result.insertId,
      message: 'Account created successfully' 
    });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Update an account
router.put('/chart-of-accounts/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      account_code, 
      name, 
      account_type_id, 
      parent_account_id, 
      description, 
      is_active 
    } = req.body;
    
    // Validate required fields
    if (!account_code || !name || !account_type_id) {
      return res.status(400).json({ error: 'Account code, name, and type are required' });
    }
    
    // Check if account code already exists (excluding this account)
    const [existingAccounts] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ? AND id != ?', 
      [account_code, id]
    );
    
    if (existingAccounts.length > 0) {
      return res.status(400).json({ error: 'Account code already exists' });
    }
    
    // Update account
    await db.query(
      `UPDATE chart_of_accounts 
       SET account_code = ?, 
           name = ?, 
           account_type_id = ?, 
           parent_account_id = ?, 
           description = ?, 
           is_active = ?
       WHERE id = ?`,
      [
        account_code, 
        name, 
        account_type_id, 
        parent_account_id || null, 
        description || null, 
        is_active !== undefined ? is_active : true,
        id
      ]
    );
    
    res.json({ message: 'Account updated successfully' });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// Get general ledger entries with filtering options
router.get('/general-ledger', auth, async (req, res) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/accounting.js:179',message:'General ledger endpoint called',data:{startDate:req.query.startDate,endDate:req.query.endDate,accountId:req.query.accountId,transactionId:req.query.transactionId},timestamp:Date.now(),runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // #region agent log
    let schemaCheck;
    try {
      const [columns] = await db.query('DESCRIBE ledger_entries');
      schemaCheck = columns.map(c => c.Field);
      fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/accounting.js:185',message:'Ledger entries table schema check',data:{columns:schemaCheck,hasDealNumber:schemaCheck.includes('deal_number'),hasTransactionId:schemaCheck.includes('transaction_id')},timestamp:Date.now(),runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
    } catch (schemaErr) {
      fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/accounting.js:189',message:'Schema check failed',data:{error:schemaErr.message},timestamp:Date.now(),runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
    }
    // #endregion
    
    const { 
      startDate, 
      endDate, 
      accountId, 
      transactionId,
      limit = 100,
      offset = 0
    } = req.query;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/accounting.js:202',message:'Building SQL queries',data:{queryUsesTransactionId:true,countQueryUsesTransactionId:true},timestamp:Date.now(),runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // When ledger points at a chart row whose account_code is an account_mappings key
    // (e.g. GSEC_ACCRUAL_INCOME_, GSEC_ACCRUAL_ASSET_C), show the mapped numeric code and name.
    let query = `
      SELECT le.*, 
             COALESCE(coa_resolved.account_code, coa.account_code) AS account_code,
             COALESCE(coa_resolved.name, coa.name) AS account_name,
             at.category as account_category,
             t.transaction_code, t.description as transaction_description
      FROM ledger_entries le
      LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
      ${LEDGER_ACCOUNT_MAPPING_JOIN}
      LEFT JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN transactions t ON le.transaction_id = t.id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Add count query for pagination
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM ledger_entries le
      LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
      ${LEDGER_ACCOUNT_MAPPING_JOIN}
      LEFT JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN transactions t ON le.transaction_id = t.id
      WHERE 1=1
    `;
    
    // Build the WHERE clause for both queries
    let whereClause = '';
    
    if (startDate) {
      whereClause += ` AND le.entry_date >= ?`;
      params.push(startDate);
    }
    
    if (endDate) {
      whereClause += ` AND le.entry_date <= ?`;
      params.push(endDate);
    }
    
    if (accountId) {
      whereClause += ` AND le.account_id = ?`;
      params.push(accountId);
    }
    
    if (transactionId) {
      whereClause += ` AND le.transaction_id = ?`;
      params.push(transactionId);
    }
    
    // #region agent log
    const finalCountQuery = countQuery + whereClause;
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/accounting.js:238',message:'About to execute count query',data:{query:finalCountQuery,params:params},timestamp:Date.now(),runId:'post-fix',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // Execute count query
    const [countResult] = await db.query(countQuery + whereClause, params);
    const total = countResult[0].total;
    
    // Add sorting and pagination to the main query
    const fullQuery = query + whereClause + ` ORDER BY le.entry_date DESC, le.id DESC LIMIT ? OFFSET ?`;
    const paginationParams = [...params, parseInt(limit), parseInt(offset)];
    
    const [entries] = await db.query(fullQuery, paginationParams);
    
    res.json({
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      entries
    });
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'routes/accounting.js:253',message:'Error caught in general ledger endpoint',data:{errorMessage:error.message,errorCode:error.code,errno:error.errno,sqlState:error.sqlState,sqlMessage:error.sqlMessage,sql:error.sql},timestamp:Date.now(),runId:'post-fix',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    console.error('Error fetching general ledger:', error);
    res.status(500).json({ error: 'Failed to fetch general ledger' });
  }
});

// Create ledger entries (usually done automatically when transactions are created)
router.post('/ledger-entries', auth, async (req, res) => {
  try {
    const { entries } = req.body;
    
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'At least one ledger entry is required' });
    }
    
    // Validate that debits equal credits
    let totalDebits = 0;
    let totalCredits = 0;
    
    entries.forEach(entry => {
      totalDebits += parseFloat(entry.debit_amount || 0);
      totalCredits += parseFloat(entry.credit_amount || 0);
    });
    
    // Allow for small rounding differences (0.01)
    if (Math.abs(totalDebits - totalCredits) > 0.01) {
      return res.status(400).json({ 
        error: 'Total debits must equal total credits',
        totalDebits,
        totalCredits
      });
    }
    
    // Insert entries
    const insertPromises = entries.map(entry => {
      return db.query(
        `INSERT INTO ledger_entries 
         (deal_number, account_id, entry_date, debit_amount, credit_amount, currency, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.deal_number || null,
          entry.account_id,
          entry.entry_date,
          entry.debit_amount || 0,
          entry.credit_amount || 0,
          entry.currency || 'LKR',
          entry.description || null
        ]
      );
    });
    
    await Promise.all(insertPromises);
    
    res.status(201).json({ message: 'Ledger entries created successfully' });
  } catch (error) {
    console.error('Error creating ledger entries:', error);
    res.status(500).json({ error: 'Failed to create ledger entries' });
  }
});

// Generate Profit and Loss statement
router.get('/profit-loss', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }
    
    // Get revenue accounts
    const [revenueAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.credit_amount - le.debit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date BETWEEN ? AND ?
      WHERE at.category = 'revenue'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [startDate, endDate]);
    
    // Get expense accounts
    const [expenseAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.debit_amount - le.credit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date BETWEEN ? AND ?
      WHERE at.category = 'expense'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [startDate, endDate]);
    
    // Calculate totals
    const totalRevenue = revenueAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const totalExpenses = expenseAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const netProfit = totalRevenue - totalExpenses;
    
    res.json({
      period: {
        startDate,
        endDate
      },
      revenue: {
        accounts: revenueAccounts,
        total: totalRevenue
      },
      expenses: {
        accounts: expenseAccounts,
        total: totalExpenses
      },
      netProfit
    });
  } catch (error) {
    console.error('Error generating profit and loss statement:', error);
    res.status(500).json({ error: 'Failed to generate profit and loss statement' });
  }
});

// Generate Balance Sheet
router.get('/balance-sheet', auth, async (req, res) => {
  try {
    const { asOfDate } = req.query;
    
    if (!asOfDate) {
      return res.status(400).json({ error: 'As of date is required' });
    }
    
    // Get asset accounts
    const [assetAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.debit_amount - le.credit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date <= ?
      WHERE at.category = 'asset'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [asOfDate]);
    
    // Get liability accounts
    const [liabilityAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.credit_amount - le.debit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date <= ?
      WHERE at.category = 'liability'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [asOfDate]);
    
    // Get equity accounts
    const [equityAccounts] = await db.query(`
      SELECT coa.id, coa.account_code, coa.name,
             COALESCE(SUM(le.credit_amount - le.debit_amount), 0) as balance
      FROM chart_of_accounts coa
      JOIN account_types at ON coa.account_type_id = at.id
      LEFT JOIN ledger_entries le ON coa.id = le.account_id 
                                 AND le.entry_date <= ?
      WHERE at.category = 'equity'
      GROUP BY coa.id
      ORDER BY coa.account_code
    `, [asOfDate]);
    
    // Calculate retained earnings (net profit/loss for all time up to asOfDate)
    const [retainedEarnings] = await db.query(`
      SELECT 
        (SELECT COALESCE(SUM(le.credit_amount - le.debit_amount), 0)
         FROM ledger_entries le
         JOIN chart_of_accounts coa ON le.account_id = coa.id
         JOIN account_types at ON coa.account_type_id = at.id
         WHERE at.category = 'revenue' AND le.entry_date <= ?) -
        (SELECT COALESCE(SUM(le.debit_amount - le.credit_amount), 0)
         FROM ledger_entries le
         JOIN chart_of_accounts coa ON le.account_id = coa.id
         JOIN account_types at ON coa.account_type_id = at.id
         WHERE at.category = 'expense' AND le.entry_date <= ?) as retained_earnings
    `, [asOfDate, asOfDate]);
    
    // Calculate totals
    const totalAssets = assetAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const totalLiabilities = liabilityAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0);
    const totalEquity = equityAccounts.reduce((sum, account) => sum + parseFloat(account.balance), 0) + 
                        parseFloat(retainedEarnings[0].retained_earnings);
    
    res.json({
      asOfDate,
      assets: {
        accounts: assetAccounts,
        total: totalAssets
      },
      liabilities: {
        accounts: liabilityAccounts,
        total: totalLiabilities
      },
      equity: {
        accounts: equityAccounts,
        retainedEarnings: parseFloat(retainedEarnings[0].retained_earnings),
        total: totalEquity
      },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity
    });
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    res.status(500).json({ error: 'Failed to generate balance sheet' });
  }
});

// ---------------------------------------------------------------------------
// Settlement Ledger Preview (month-bucketed, excludes daily accrual/amortization)
// ---------------------------------------------------------------------------

const SETTLEMENT_EXCLUDED_DESCRIPTION_LIKE = [
  'GSec Daily Accrual%',
  'GSec Daily Amortization%',
  'GSec Coupon Settlement%',
  'Repo Daily Interest Accrual%',
  'Reverse Repo Daily Interest Accrual%',
];

const SETTLEMENT_EXCLUDED_DESCRIPTION_EXACT = [
  'Daily lending interest EOD',
  'Daily borrowing interest EOD',
];

const SETTLEMENT_CATEGORY_DEFS = [
  { key: 'gsec_buy', label: 'G-Sec Buy' },
  { key: 'gsec_sell', label: 'G-Sec Sell' },
  { key: 'repo', label: 'Repo' },
  { key: 'reverse_repo', label: 'Reverse Repo' },
  { key: 'mm_lending', label: 'MM Lending' },
  { key: 'mm_borrowing', label: 'MM Borrowing' },
  { key: 'fixed_deposit', label: 'Fixed Deposit' },
  { key: 'maturity', label: 'Maturity' },
  { key: 'other', label: 'Other' },
];

const MONTH_LABELS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function classifyLedgerDescription(description) {
  const d = (description || '').trim();
  if (!d) return 'other';
  const dl = d.toLowerCase();

  if (/^GSec Purchase\b/i.test(d) || /Buyback .* - GSec Purchase\b/i.test(d)) return 'gsec_buy';
  if (/^GSec Sale\b/i.test(d) || /Buyback .* - GSec Sale\b/i.test(d)) return 'gsec_sell';
  if (/^Repo Purchase\b/i.test(d) || /^Repo Maturity\b/i.test(d)) return 'repo';
  if (/^Reverse Repo Borrowing\b/i.test(d) || /^Reverse Repo Maturity\b/i.test(d)) return 'reverse_repo';
  if (/^Lending\s*-/i.test(d)) return 'mm_lending';
  if (/^Borrowing\s*-/i.test(d)) return 'mm_borrowing';
  if (/^Fixed Deposit\s*-/i.test(d)) return 'fixed_deposit';
  if (dl.includes('interest payment') || dl.includes('interest receipt') || dl.includes('interest accrual reversal')) {
    return 'maturity';
  }
  return 'other';
}

function buildEmptyGroups() {
  const groups = {};
  for (const def of SETTLEMENT_CATEGORY_DEFS) {
    groups[def.key] = {
      label: def.label,
      totals: { debit: 0, credit: 0, count: 0 },
      entries: [],
    };
  }
  return groups;
}

router.get('/settlement-preview', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || 2026;
    const monthsRaw = (req.query.months || '4,5').toString();
    const months = monthsRaw
      .split(',')
      .map((m) => parseInt(m.trim(), 10))
      .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);

    if (months.length === 0) {
      return res.status(400).json({ error: 'months must include at least one valid month (1-12)' });
    }

    const categoryFilter = req.query.category ? req.query.category.toString() : null;
    if (categoryFilter && !SETTLEMENT_CATEGORY_DEFS.some((c) => c.key === categoryFilter)) {
      return res.status(400).json({ error: `Unknown category: ${categoryFilter}` });
    }

    const excludeLikeClause = SETTLEMENT_EXCLUDED_DESCRIPTION_LIKE
      .map(() => `le.description NOT LIKE ?`)
      .join(' AND ');
    const excludeExactPlaceholders = SETTLEMENT_EXCLUDED_DESCRIPTION_EXACT.map(() => '?').join(', ');
    const monthPlaceholders = months.map(() => '?').join(', ');

    const sql = `
      SELECT le.*,
             MONTH(le.entry_date) AS month_num,
             COALESCE(coa_resolved.account_code, coa.account_code) AS account_code,
             COALESCE(coa_resolved.name, coa.name) AS account_name,
             at.category AS account_category
      FROM ledger_entries le
      LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
      ${LEDGER_ACCOUNT_MAPPING_JOIN}
      LEFT JOIN account_types at ON coa.account_type_id = at.id
      WHERE YEAR(le.entry_date) = ?
        AND MONTH(le.entry_date) IN (${monthPlaceholders})
        AND ${excludeLikeClause}
        AND le.description NOT IN (${excludeExactPlaceholders})
      ORDER BY le.entry_date ASC, le.id ASC
    `;

    const params = [
      year,
      ...months,
      ...SETTLEMENT_EXCLUDED_DESCRIPTION_LIKE,
      ...SETTLEMENT_EXCLUDED_DESCRIPTION_EXACT,
    ];

    const [rows] = await db.query(sql, params);

    const monthBuckets = new Map();
    for (const m of months) {
      monthBuckets.set(m, {
        month: m,
        label: `${MONTH_LABELS[m]} ${year}`,
        totals: { debit: 0, credit: 0, count: 0 },
        groups: buildEmptyGroups(),
      });
    }

    for (const row of rows) {
      const category = classifyLedgerDescription(row.description);
      if (categoryFilter && category !== categoryFilter) continue;

      const bucket = monthBuckets.get(row.month_num);
      if (!bucket) continue;

      const debit = parseFloat(row.debit_amount) || 0;
      const credit = parseFloat(row.credit_amount) || 0;

      const enriched = { ...row, category };

      const group = bucket.groups[category] || bucket.groups.other;
      group.entries.push(enriched);
      group.totals.debit += debit;
      group.totals.credit += credit;
      group.totals.count += 1;

      bucket.totals.debit += debit;
      bucket.totals.credit += credit;
      bucket.totals.count += 1;
    }

    const monthsResp = Array.from(monthBuckets.values()).sort((a, b) => a.month - b.month);

    res.json({
      year,
      months: monthsResp,
      excludedPatterns: [
        ...SETTLEMENT_EXCLUDED_DESCRIPTION_LIKE,
        ...SETTLEMENT_EXCLUDED_DESCRIPTION_EXACT,
      ],
      categories: SETTLEMENT_CATEGORY_DEFS,
    });
  } catch (error) {
    console.error('Error fetching settlement preview:', error);
    res.status(500).json({ error: 'Failed to fetch settlement preview' });
  }
});

module.exports = router;
