#!/usr/bin/env node
'use strict';
/**
 * Remove the duplicate isin_master row for LKB00934J156 (ids 54 + 56 are
 * identical; keep 54) and dedupe its isin_coupon_schedule rows (every coupon
 * date was inserted twice because the ISIN was created twice from the ISIN
 * master screen, which has no duplicate guard).
 *
 * The duplicate master row made every GSEC-report buy row on this ISIN appear
 * twice (the report LEFT JOINs isin_master by isin_number).
 *
 * Usage: node scripts/fix-duplicate-isin-lkb00934j156.js [--execute]
 */
require('dotenv').config();
const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const ISIN = 'LKB00934J156';
const KEEP_ID = 54;
const DELETE_ID = 56;

(async () => {
  const [masters] = await db.query(
    `SELECT id, isin_number, coupon_rate, issue_date, maturity_date, coupon_date_1, coupon_date_2, series, day_basis, currency
     FROM isin_master WHERE TRIM(isin_number) = ?`, [ISIN]
  );
  console.table(masters);
  if (masters.length !== 2 || !masters.some(m => m.id === KEEP_ID) || !masters.some(m => m.id === DELETE_ID)) {
    console.error('Unexpected isin_master state - aborting.');
    process.exit(1);
  }

  // Coupon schedule rows to remove: for each coupon_date keep the lowest id.
  const [dupSched] = await db.query(
    `SELECT s.id FROM isin_coupon_schedule s
     JOIN (SELECT coupon_date, MIN(id) AS keep_id FROM isin_coupon_schedule
           WHERE TRIM(isin) = ? GROUP BY coupon_date) k
       ON s.coupon_date = k.coupon_date AND s.id <> k.keep_id
     WHERE TRIM(s.isin) = ?`, [ISIN, ISIN]
  );
  console.log(`isin_master row to delete: id ${DELETE_ID} (keeping ${KEEP_ID})`);
  console.log(`Duplicate coupon-schedule rows to delete: ${dupSched.length}`, dupSched.map(r => r.id));

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    const [d1] = await conn.query('DELETE FROM isin_master WHERE id = ?', [DELETE_ID]);
    console.log(`isin_master rows deleted: ${d1.affectedRows}`);
    if (dupSched.length) {
      const ids = dupSched.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const [d2] = await conn.query(`DELETE FROM isin_coupon_schedule WHERE id IN (${ph})`, ids);
      console.log(`isin_coupon_schedule rows deleted: ${d2.affectedRows}`);
    }
    await conn.commit();
    console.log('DONE.');
  } catch (e) {
    await conn.rollback();
    console.error('ROLLED BACK:', e.message);
    process.exit(1);
  } finally {
    conn.release();
  }
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
