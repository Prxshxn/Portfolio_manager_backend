const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');

const DEAL = 'BB20260518002';
const NEW_LEG2_DATE = '2026-05-29';
const LEG1_RATE = 11.5; // stored on deal; 364 basis matches leg2 settlement
const DAY_COUNT_BASIS = 364;

function calcDaysBetween(d1Str, d2Str) {
  const d1 = new Date(d1Str);
  const d2 = new Date(d2Str);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  return Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

(async () => {
  const [rows] = await db.query('SELECT * FROM buyback_deals WHERE deal_number = ? LIMIT 1', [DEAL]);
  if (!rows.length) { console.log('Deal not found'); process.exit(1); }
  const d = rows[0];

  const systemDay = await getSystemDay();
  const basis = DAY_COUNT_BASIS;
  const leg1Settlement = parseFloat(d.leg1_settlement_amount);
  const daysCurrent = calcDaysBetween(d.leg1_value_date, d.leg2_value_date);
  const daysNew = calcDaysBetween(d.leg1_value_date, NEW_LEG2_DATE);
  const interestNew = leg1Settlement * (LEG1_RATE / 100) * (daysNew / basis);
  const newLeg2Settlement = round2(leg1Settlement + interestNew);
  const fv = parseFloat(d.leg1_face_value) || parseFloat(d.leg2_face_value);
  const dirtyNew = fv > 0 ? round4((newLeg2Settlement * 100) / fv) : null;
  const leg1Accrued = (parseFloat(d.leg1_dirty_price) || 0) - (parseFloat(d.leg1_clean_price) || 0);
  const cleanNew = dirtyNew != null ? round4(dirtyNew - leg1Accrued) : null;

  const leg2LedgerKey = `${DEAL}/BB-L2/SELL`;
  const [leg2Le] = await db.query('SELECT COUNT(*) AS c FROM ledger_entries WHERE deal_number = ?', [leg2LedgerKey]);
  const [gsecSell] = await db.query(
    `SELECT deal_number, status, value_date, face_value, settlement_amount
       FROM gsec WHERE buyback_deal_id = ? OR deal_number LIKE ?`,
    [d.id, `%${DEAL}%`]
  );

  console.log('=== PREVIEW ONLY — NO CHANGES MADE ===\n');
  console.log('Deal:', DEAL, `(id ${d.id})`);
  console.log('Structure:', d.leg1_transaction_type, '/', d.leg2_transaction_type, '(Buy/Sell)');
  console.log('Status:', d.deal_status, '| approved_at:', d.approved_at);
  console.log('Counterparty:', d.leg1_counterparty);
  console.log('ISIN:', d.leg1_isin);
  console.log('System day:', systemDay?.system_date);
  console.log('');
  console.log('--- CURRENT leg 2 (Sell) ---');
  console.log('Value date:', String(d.leg2_value_date).slice(0, 10));
  console.log('Settlement:', d.leg2_settlement_amount);
  console.log('Clean / Dirty:', d.leg2_clean_price, '/', d.leg2_dirty_price);
  console.log('DTM (days):', daysCurrent);
  console.log('');
  console.log('--- PROPOSED premature leg 2 ---');
  console.log('New value date:', NEW_LEG2_DATE);
  console.log('New DTM (days):', daysNew, `(was ${daysCurrent})`);
  console.log('Leg1 rate used:', LEG1_RATE + '%', '| basis:', basis);
  console.log('Recalc interest:', round2(interestNew));
  console.log('New leg2 settlement (est):', newLeg2Settlement, `(current ${d.leg2_settlement_amount})`);
  console.log('New leg2 dirty (est):', dirtyNew);
  console.log('New leg2 clean (est):', cleanNew, '(leg1 accrued spread method)');
  console.log('');
  console.log('--- Ledger / downstream (read-only) ---');
  console.log('Leg2 sell ledger lines (`' + leg2LedgerKey + '`):', leg2Le[0].c, '(would NOT post in preview; user asked no entries)');
  console.log('Linked GSEC rows:', gsecSell.length ? gsecSell : 'none via buyback_deal_id');
  console.log('');
  console.log('--- What execution would do (API: POST /maturity/premature/buyback) ---');
  console.log('1. UPDATE buyback_deals: leg2_value_date, leg2_settlement_amount, leg2 prices, leg1_interest_rate');
  console.log('2. INSERT maturity_processing_log (premature_maturity)');
  console.log('3. Buy/Sell: does NOT cancel/recreate GSEC Buy (only applies when leg2 is Buy)');
  console.log('4. Ledger: NOT posted by premature API itself; leg2 sell posts on EOD when system day reaches leg2 value date');
  console.log('');
  if (d.leg2_transaction_type === 'Sell' && NEW_LEG2_DATE >= String(d.leg1_value_date).slice(0, 10)) {
    console.log('Validation: new date is after leg1 value date — OK');
  }
  if (new Date(NEW_LEG2_DATE) < new Date(String(systemDay?.system_date || '').slice(0, 10))) {
    console.log('WARNING: new leg2 date is BEFORE system day — premature API may reject');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
