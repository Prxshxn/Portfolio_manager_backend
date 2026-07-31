#!/usr/bin/env node
'use strict';

/**
 * BB20260715004 / leg-2 Buy 20260817/GSEC/0002 (gsec id 590):
 * the premature (27-Jul-2026) was applied through the generic GSEC flow, which
 * only stamped gsec.maturity_date = 2026-07-27 and left the settlement dates
 * at 17-Aug-2026 - making the deal invisible to the daily maturity cashflow
 * and the GSec report.
 *
 * Correction (early settlement of the buyback on 27-Jul-2026):
 *   gsec 590:      value_date    2026-08-17 -> 2026-07-27
 *                  maturity_date 2026-07-27 -> bond maturity from isin_master
 *                                              (position enters holdings normally)
 *   buyback 190:   leg2_value_date 2026-08-17 -> 2026-07-27
 *
 * Settlement / accrued amounts are NOT changed.
 *
 * Usage: node scripts/fix-premature-bb20260715004-leg2.js [--execute]
 */

const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const GSEC_ID = 590;
const BB_ID = 190;
const DEAL_NUMBER = '20260817/GSEC/0002';
const BB_NUMBER = 'BB20260715004';
const PREMATURE_DATE = '2026-07-27';

const ymd = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

(async () => {
  const [g] = await db.query(
    'SELECT id, deal_number, isin_number, value_date, maturity_date, buyback_deal_id FROM gsec WHERE id = ?',
    [GSEC_ID]
  );
  const [bb] = await db.query(
    'SELECT id, deal_number, leg2_value_date, deal_status FROM buyback_deals WHERE id = ?',
    [BB_ID]
  );
  if (!g.length || !bb.length) throw new Error('Required rows not found');
  if (g[0].deal_number !== DEAL_NUMBER || bb[0].deal_number !== BB_NUMBER) {
    throw new Error(`Row mismatch: gsec=${g[0].deal_number}, bb=${bb[0].deal_number} - aborting`);
  }
  if (Number(g[0].buyback_deal_id) !== BB_ID) {
    throw new Error(`gsec ${GSEC_ID} buyback_deal_id=${g[0].buyback_deal_id}, expected ${BB_ID} - aborting`);
  }

  const [isin] = await db.query(
    'SELECT maturity_date FROM isin_master WHERE isin_number = ? LIMIT 1',
    [g[0].isin_number]
  );
  if (!isin.length || !isin[0].maturity_date) throw new Error('ISIN maturity not found');
  const bondMaturity = ymd(isin[0].maturity_date);

  console.log('=== Current ===');
  console.log(`gsec value_date      = ${ymd(g[0].value_date)}`);
  console.log(`gsec maturity_date   = ${ymd(g[0].maturity_date)}`);
  console.log(`bb leg2_value_date   = ${ymd(bb[0].leg2_value_date)}`);

  if (ymd(g[0].value_date) !== '2026-08-17' || ymd(g[0].maturity_date) !== PREMATURE_DATE) {
    throw new Error('gsec row not in expected pre-fix state - aborting (maybe already fixed?)');
  }
  if (ymd(bb[0].leg2_value_date) !== '2026-08-17') {
    throw new Error('buyback row not in expected pre-fix state - aborting');
  }

  console.log('\n=== Planned ===');
  console.log(`gsec value_date      -> ${PREMATURE_DATE}`);
  console.log(`gsec maturity_date   -> ${bondMaturity} (bond maturity restored)`);
  console.log(`bb leg2_value_date   -> ${PREMATURE_DATE}`);
  console.log('Settlement / accrued -> unchanged');

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  await db.query(
    'UPDATE gsec SET value_date = ?, maturity_date = ?, updated_at = NOW() WHERE id = ?',
    [PREMATURE_DATE, bondMaturity, GSEC_ID]
  );
  await db.query(
    'UPDATE buyback_deals SET leg2_value_date = ?, updated_at = NOW() WHERE id = ?',
    [PREMATURE_DATE, BB_ID]
  );
  await db.query(
    `INSERT INTO maturity_processing_log
     (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
      processed_date, processed_by, authorization_level, notes)
     SELECT id, deal_number, 'premature_maturity', face_value, 0, face_value, ?, 0, 'system', ?
     FROM gsec WHERE id = ?`,
    [
      PREMATURE_DATE,
      `Correction: buyback ${BB_NUMBER} leg2 early settlement - value_date/leg2_value_date moved to ${PREMATURE_DATE}, bond maturity ${bondMaturity} restored`,
      GSEC_ID
    ]
  );

  const [gAfter] = await db.query('SELECT value_date, maturity_date FROM gsec WHERE id = ?', [GSEC_ID]);
  const [bbAfter] = await db.query('SELECT leg2_value_date FROM buyback_deals WHERE id = ?', [BB_ID]);
  console.log('\n=== After ===');
  console.log(`gsec value_date      = ${ymd(gAfter[0].value_date)}`);
  console.log(`gsec maturity_date   = ${ymd(gAfter[0].maturity_date)}`);
  console.log(`bb leg2_value_date   = ${ymd(bbAfter[0].leg2_value_date)}`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
