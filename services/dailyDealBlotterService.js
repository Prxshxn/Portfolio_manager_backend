const pool = require('../config/database');
const counterpartyModel = require('../models/counterpartyModel');
const User = require('../models/userModel');

function buildCounterpartyLookup(rows) {
  const byKey = new Map();
  const numericMaps = {
    corporate: new Map(),
    individual: new Map(),
    joint: new Map()
  };

  for (const cp of rows) {
    const shortName = cp.short_name || cp.long_name;
    if (!shortName) continue;

    byKey.set(String(cp.unique_id), shortName);
    byKey.set(String(cp.unique_id).toLowerCase(), shortName);

    const prefix = cp.type === 'corporate' ? 'c' : cp.type === 'individual' ? 'i' : 'j';
    byKey.set(`${prefix}${cp.original_id}`, shortName);

    numericMaps[cp.type].set(Number(cp.original_id), shortName);
  }

  return { byKey, numericMaps };
}

function resolveCounterpartyName(raw, lookup) {
  if (raw === null || raw === undefined || raw === '') return null;
  const key = String(raw).trim();
  if (!key) return null;

  if (lookup.byKey.has(key)) return lookup.byKey.get(key);
  const lower = key.toLowerCase();
  if (lookup.byKey.has(lower)) return lookup.byKey.get(lower);

  if (/^\d+$/.test(key)) {
    const n = Number(key);
    return lookup.numericMaps.corporate.get(n)
      || lookup.numericMaps.individual.get(n)
      || lookup.numericMaps.joint.get(n)
      || key;
  }

  return key;
}

function buildUserLookup(rows) {
  const byId = new Map();
  const byUsername = new Map();
  for (const u of rows) {
    if (u.id != null) {
      byId.set(Number(u.id), u.username);
    }
    if (u.username) {
      byUsername.set(String(u.username).toLowerCase(), u.username);
    }
  }
  return { byId, byUsername };
}

function resolveEnteredBy(raw, lookup) {
  if (raw === null || raw === undefined || raw === '') return null;
  const key = String(raw).trim();
  if (!key) return null;
  const asNum = Number(key);
  if (Number.isFinite(asNum) && asNum > 0 && lookup.byId.has(asNum)) {
    return lookup.byId.get(asNum);
  }
  const byName = lookup.byUsername.get(key.toLowerCase());
  if (byName) return byName;
  return key;
}

// Normalizes the many inconsistent status/approval-level spellings used across
// deal tables (see CLAUDE.md note on raw-SQL, per-table workflow columns) into
// a single display bucket for the combined blotter.
function normalizeStatus(rawStatus, approvalLevel) {
  const status = (rawStatus || '').toString().trim().toLowerCase();
  const level = (approvalLevel || '').toString().trim().toLowerCase();

  if (['rejected', 'returned', 'cancelled'].includes(status)) return 'Rejected';
  if (['draft'].includes(status)) return 'Draft';
  if (['approved', 'final_approved', 'settled', 'matured', 'active'].includes(status)) return 'Approved';

  if (status === 'pending' || status === 'pending_verification' || status === 'verified' || status === 'pending_final_approval') {
    if (level === 'back_office_final' || status === 'pending_final_approval') return 'Pending Final Approval';
    if (level === 'back_office_verifier' || status === 'verified') return 'Pending Back Office Verification';
    return 'Pending Front Office';
  }

  return rawStatus || 'Unknown';
}

function mapRow(dealType, row) {
  return {
    dealType,
    dealNumber: row.deal_number,
    dealDate: row.deal_date,
    valueDate: row.value_date,
    counterparty: row.counterparty,
    instrument: row.instrument,
    amount: row.amount !== undefined && row.amount !== null ? Number(row.amount) : null,
    rate: row.rate !== undefined && row.rate !== null ? Number(row.rate) : null,
    rawStatus: row.status,
    approvalLevel: row.approval_level,
    status: normalizeStatus(row.status, row.approval_level),
    enteredBy: row.entered_by
  };
}

async function safeQuery(dealType, sql, params) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows.map(row => mapRow(dealType, row));
  } catch (error) {
    console.error(`[dailyDealBlotter] Failed to fetch ${dealType} deals:`, error.message);
    return [];
  }
}

async function getTransactions(date) {
  return safeQuery('TRANSACTION', `
    SELECT
      t.transaction_code AS deal_number,
      COALESCE(t.trade_date, t.date) AS deal_date,
      t.value_date AS value_date,
      t.counterparty_id AS counterparty,
      t.security_id AS instrument,
      t.amount AS amount,
      t.interest_rate AS rate,
      t.status AS status,
      NULL AS approval_level,
      COALESCE(NULLIF(t.submitted_by, 0), NULLIF(t.user, 0)) AS entered_by
    FROM transactions t
    WHERE DATE(COALESCE(t.trade_date, t.date)) = ?
  `, [date]);
}

async function getMoneyMarketDeals(date) {
  return safeQuery('MONEY_MARKET', `
    SELECT
      mm.deal_number AS deal_number,
      mm.trade_date AS deal_date,
      mm.value_date AS value_date,
      mm.counterparty_id AS counterparty,
      mm.product_type AS instrument,
      mm.principal_amount AS amount,
      mm.interest_rate AS rate,
      mm.status AS status,
      mm.current_approval_level AS approval_level,
      NULL AS entered_by
    FROM money_market_deals mm
    WHERE DATE(mm.trade_date) = ?
  `, [date]);
}

async function getGsecDeals(date) {
  return safeQuery('GSEC', `
    SELECT
      g.deal_number AS deal_number,
      g.trade_date AS deal_date,
      g.value_date AS value_date,
      g.counterparty_id AS counterparty,
      g.isin_number AS instrument,
      g.face_value AS amount,
      g.yield AS rate,
      g.status AS status,
      g.current_approval_level AS approval_level,
      NULL AS entered_by
    FROM gsec g
    WHERE DATE(g.trade_date) = ?
  `, [date]);
}

async function getTbillDeals(date) {
  return safeQuery('TBILL', `
    SELECT
      tb.deal_number AS deal_number,
      tb.trade_date AS deal_date,
      tb.value_date AS value_date,
      tb.counterparty AS counterparty,
      tb.isin_number AS instrument,
      tb.face_value AS amount,
      tb.discount_rate_pct AS rate,
      tb.status AS status,
      tb.current_approval_level AS approval_level,
      u.username AS entered_by
    FROM tbill tb
    LEFT JOIN users u ON u.id = tb.user_id
    WHERE DATE(tb.trade_date) = ?
  `, [date]);
}

async function getBuybackDeals(date) {
  return safeQuery('BUYBACK', `
    SELECT
      b.deal_number AS deal_number,
      COALESCE(b.leg1_trade_date, b.leg2_trade_date) AS deal_date,
      b.leg1_value_date AS value_date,
      b.leg1_counterparty AS counterparty,
      b.leg1_isin AS instrument,
      b.leg1_face_value AS amount,
      b.leg1_yield_rate AS rate,
      b.deal_status AS status,
      NULL AS approval_level,
      u.username AS entered_by
    FROM buyback_deals b
    LEFT JOIN users u ON u.id = b.created_by
    WHERE DATE(b.leg1_trade_date) = ? OR DATE(b.leg2_trade_date) = ?
  `, [date, date]);
}

async function getFixedDepositDeals(date) {
  return safeQuery('FIXED_DEPOSIT', `
    SELECT
      fd.request_no AS deal_number,
      COALESCE(fd.submitted_at, fd.created_at) AS deal_date,
      fd.value_date AS value_date,
      fd.counterparty_id AS counterparty,
      fd.isin AS instrument,
      fd.requested_amount AS amount,
      fd.target_yield AS rate,
      fd.status AS status,
      fd.current_approval_level AS approval_level,
      u.username AS entered_by
    FROM fixed_deposit_requests fd
    LEFT JOIN users u ON u.id = fd.submitted_by
    WHERE DATE(COALESCE(fd.submitted_at, fd.created_at)) = ?
  `, [date]);
}

async function getRepoDeals(date) {
  return safeQuery('REPO', `
    SELECT
      CONCAT('REPO-', r.id) AS deal_number,
      r.trade_date AS deal_date,
      r.value_date AS value_date,
      r.counterparty_id AS counterparty,
      r.isin_number AS instrument,
      COALESCE(r.principal_amount, r.face_value) AS amount,
      r.rate AS rate,
      COALESCE(r.approval_status, r.status) AS status,
      r.current_approval_level AS approval_level,
      u.username AS entered_by
    FROM repo_deals r
    LEFT JOIN users u ON u.id = r.created_by
    WHERE DATE(r.trade_date) = ?
  `, [date]);
}

async function getDailyDealBlotter(date) {
  const [cpLookup, users] = await Promise.all([
    counterpartyModel.getAll().then(buildCounterpartyLookup),
    User.getAll()
  ]);
  const userLookup = buildUserLookup(users);

  const results = await Promise.all([
    getTransactions(date),
    getMoneyMarketDeals(date),
    getGsecDeals(date),
    getTbillDeals(date),
    getBuybackDeals(date),
    getFixedDepositDeals(date),
    getRepoDeals(date)
  ]);

  const deals = results.flat().map((deal) => ({
    ...deal,
    counterparty: resolveCounterpartyName(deal.counterparty, cpLookup) || deal.counterparty,
    enteredBy: resolveEnteredBy(deal.enteredBy, userLookup) || deal.enteredBy || null
  }));
  deals.sort((a, b) => {
    const dateDiff = new Date(a.dealDate) - new Date(b.dealDate);
    if (dateDiff !== 0) return dateDiff;
    return a.dealType.localeCompare(b.dealType);
  });

  const summary = deals.reduce((acc, deal) => {
    acc.totalDeals += 1;
    acc.byDealType[deal.dealType] = (acc.byDealType[deal.dealType] || 0) + 1;
    acc.byStatus[deal.status] = (acc.byStatus[deal.status] || 0) + 1;
    return acc;
  }, { totalDeals: 0, byDealType: {}, byStatus: {} });

  return { deals, summary };
}

module.exports = { getDailyDealBlotter };
