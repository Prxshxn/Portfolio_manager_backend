/*
 * Reverts approved_at to NULL for the 13 pre-existing buyback rows that were
 * incorrectly backfilled by scripts/run-backfill-buyback-approved-at.js.
 *
 * Keeps approved_at populated only for the 8 buybacks actually entered on
 * 2026-04-20 (ids 42..49). This fixes the spurious FIFO deductions against
 * 20260116/GSEC/0001 and 0002 (and similar older deals) in the GSEC report.
 *
 * Usage:
 *   node scripts/revert-backfill-buyback-approved-at.js           (dry-run)
 *   node scripts/revert-backfill-buyback-approved-at.js --apply   (executes)
 */

const pool = require('../config/db');

const REVERT_IDS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19, 21];

async function main() {
  const apply = process.argv.includes('--apply');

  const ph = REVERT_IDS.map(() => '?').join(',');

  const [before] = await pool.query(
    `SELECT id, deal_number, deal_status, approved_at, updated_at, created_at, leg1_isin, leg1_face_value
     FROM buyback_deals
     WHERE id IN (${ph})
     ORDER BY id ASC`,
    REVERT_IDS
  );

  console.log(`Rows targeted for revert: ${before.length}`);
  before.forEach((r) => {
    console.log(
      `  id=${r.id} deal_number=${r.deal_number} status=${r.deal_status} ` +
      `approved_at=${r.approved_at} updated_at=${r.updated_at} ` +
      `isin=${r.leg1_isin} face=${r.leg1_face_value}`
    );
  });

  if (!apply) {
    console.log('\nDry-run complete. Pass --apply to execute the UPDATE.');
    await pool.end();
    return;
  }

  const [result] = await pool.query(
    `UPDATE buyback_deals SET approved_at = NULL WHERE id IN (${ph})`,
    REVERT_IDS
  );
  console.log(`\nUPDATE affected rows: ${result.affectedRows}`);

  const [remaining] = await pool.query(
    `SELECT id, deal_number, approved_at FROM buyback_deals WHERE id IN (${ph}) ORDER BY id ASC`,
    REVERT_IDS
  );
  console.log(`\nPost-revert state (should all show approved_at=null):`);
  remaining.forEach((r) =>
    console.log(`  id=${r.id} deal_number=${r.deal_number} approved_at=${r.approved_at}`)
  );

  const [still] = await pool.query(`
    SELECT id, deal_number, approved_at, updated_at, created_at
    FROM buyback_deals
    WHERE deal_status = 'Approved' AND approved_at IS NOT NULL
      AND DATE(approved_at) = '2026-04-20'
    ORDER BY id ASC
  `);
  console.log(`\nKept populated (should be the 8 deals entered today):`);
  still.forEach((r) =>
    console.log(`  id=${r.id} deal_number=${r.deal_number} approved_at=${r.approved_at}`)
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error('Revert failed:', err);
  try { await pool.end(); } catch (_) { /* noop */ }
  process.exit(1);
});
