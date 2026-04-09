/**
 * One-off script to cancel GSec deals auto-created by buyback deals that were later rejected.
 * Usage: node scripts/cancelOrphanedBuybackGsec.js [--execute]
 * Without --execute, runs in dry-run mode.
 */
const db = require('../config/database');

async function run() {
  const dryRun = !process.argv.includes('--execute');
  console.log(dryRun ? '=== DRY RUN ===' : '=== EXECUTING ===');

  const [orphans] = await db.query(`
    SELECT g.id, g.deal_number, g.isin_number, g.face_value, g.value_date, g.portfolio,
           bb.deal_number AS bb_deal_number, bb.deal_status AS bb_status
    FROM gsec g
    JOIN buyback_deals bb
      ON bb.leg2_isin = g.isin_number
     AND bb.leg2_face_value = g.face_value
     AND bb.leg2_value_date = g.value_date
     AND bb.leg2_portfolio = g.portfolio
     AND bb.leg2_transaction_type = 'Buy'
    WHERE g.transaction_type = 'Buy'
      AND g.status = 'final_approved'
      AND bb.deal_status = 'Rejected'
    ORDER BY g.id
  `);

  console.log(`Found ${orphans.length} orphaned GSec deal(s) from rejected buybacks:`);
  for (const row of orphans) {
    console.log(
      `  GSec ${row.deal_number} (id=${row.id}) | ISIN ${row.isin_number} | FV ${row.face_value} | Buyback ${row.bb_deal_number} (${row.bb_status})`
    );
    if (!dryRun) {
      await db.query("UPDATE gsec SET status = 'cancelled', per_day_accrual = 0 WHERE id = ?", [row.id]);
      console.log(`    -> cancelled`);
    }
  }

  if (dryRun && orphans.length > 0) {
    console.log('\nRe-run with --execute to apply changes.');
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
