/*
 * One-off runner for migrations/20260421-backfill-buyback-approved-at.sql
 *
 * Populates buyback_deals.approved_at for rows where deal_status='Approved'
 * AND approved_at IS NULL, using COALESCE(updated_at, created_at).
 *
 * Usage:
 *   node scripts/run-backfill-buyback-approved-at.js          (dry-run: prints impacted rows, no writes)
 *   node scripts/run-backfill-buyback-approved-at.js --apply  (executes the UPDATE)
 */

const pool = require('../config/db');

async function main() {
  const apply = process.argv.includes('--apply');

  const [before] = await pool.query(`
    SELECT id, deal_number, deal_status, approved_at, updated_at, created_at
    FROM buyback_deals
    WHERE deal_status = 'Approved' AND approved_at IS NULL
    ORDER BY id ASC
  `);

  console.log(`Rows needing backfill: ${before.length}`);
  before.forEach(r => {
    const chosen = r.updated_at || r.created_at;
    console.log(
      `  id=${r.id} deal_number=${r.deal_number} updated_at=${r.updated_at} created_at=${r.created_at} -> approved_at=${chosen}`
    );
  });

  if (!apply) {
    console.log('\nDry-run complete. Pass --apply to execute the UPDATE.');
    await pool.end();
    return;
  }

  const [result] = await pool.query(`
    UPDATE buyback_deals
    SET approved_at = COALESCE(updated_at, created_at)
    WHERE deal_status = 'Approved' AND approved_at IS NULL
  `);

  console.log(`\nUPDATE affected rows: ${result.affectedRows}`);

  const [after] = await pool.query(`
    SELECT COUNT(*) AS remaining
    FROM buyback_deals
    WHERE deal_status = 'Approved' AND approved_at IS NULL
  `);
  console.log(`Remaining Approved rows with NULL approved_at: ${after[0].remaining}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  try { await pool.end(); } catch (_) { /* noop */ }
  process.exit(1);
});
