/**
 * Backfill missing/incorrect T-Bill daily accrual for buy deal 20260608/TBILL/0002,
 * 2026-06-08 through 2026-07-09.
 *
 * Two distinct gaps, both stemming from the buy deal's remaining_face_value history:
 *   - 2026-06-08: no posting at all (deal became eligible that day, full 50,000,000
 *     face, before any Sell existed).
 *   - 2026-06-09, 2026-06-10: no posting (the first Sell, 42,000,000, was created
 *     2026-06-09 - under the same DATE()-truncated convention the rest of the run
 *     already uses, that day and the next should have posted at the reduced
 *     8,000,000 remaining face, matching every day from 06-11 onward).
 *   - 2026-07-07..2026-07-09: posted, but at the WRONG (too-low) rate, because a
 *     Sell that was later rejected had wrongly deducted the buy deal's
 *     remaining_face_value down to 4,875,000 in that window (now corrected back
 *     to 8,000,000 - see Tbill.updateStatus restore-on-reject fix).
 *
 * Reuses the real postTbillDailyAccrual() function for every day, just overriding
 * remaining_face_value to the correct historical value for that day, after
 * deleting any existing (wrong) entry for that day so it can post cleanly.
 *
 * Usage:
 *   node scripts/backfill-tbill-0002-daily-accrual.js           (dry run, no writes)
 *   node scripts/backfill-tbill-0002-daily-accrual.js --commit  (posts backfill entries)
 */
const db = require('../config/database');
const tbillLedgerService = require('../services/tbillLedgerService');

const COMMIT = process.argv.includes('--commit');
const DEAL_NUMBER = '20260608/TBILL/0002';

// day -> correct historical remaining_face_value
const PLAN = {
  '2026-06-08': 50000000,
  '2026-06-09': 8000000,
  '2026-06-10': 8000000,
  '2026-07-07': 8000000,
  '2026-07-08': 8000000,
  '2026-07-09': 8000000
};

async function main() {
  const [rows] = await db.query('SELECT * FROM tbill WHERE deal_number = ? LIMIT 1', [DEAL_NUMBER]);
  if (!rows.length) throw new Error(`Deal not found: ${DEAL_NUMBER}`);
  const deal = rows[0];

  const [existing] = await db.query(
    `SELECT entry_date, debit_amount FROM ledger_entries
     WHERE deal_number = ? AND description = ? AND debit_amount > 0
       AND DATE(entry_date) IN (${Object.keys(PLAN).map(() => '?').join(',')})`,
    [DEAL_NUMBER, `TBill Daily Accrual for Deal ${DEAL_NUMBER}`, ...Object.keys(PLAN)]
  );
  const postedMap = new Map(existing.map((r) => [new Date(r.entry_date).toISOString().slice(0, 10), Number(r.debit_amount)]));

  console.log(`Backfill plan for ${DEAL_NUMBER}:`);
  const rowsOut = [];
  for (const [day, remaining] of Object.entries(PLAN)) {
    const computed = tbillLedgerService.computeTbillDailyAccrual(
      Object.assign({}, deal, { remaining_face_value: remaining })
    );
    const correctAmt = computed.ok ? Number(computed.amount.toFixed(2)) : 0;
    const posted = postedMap.get(day) || 0;
    rowsOut.push({ day, remaining, correctAmt, posted, action: posted ? 'correct' : 'fill-gap' });
  }
  console.table(rowsOut);

  if (!COMMIT) {
    console.log('\nDry run complete. Re-run with --commit to apply.');
    process.exit(0);
  }

  for (const [day, remaining] of Object.entries(PLAN)) {
    // Clear any existing (wrong) entry for this day so postTbillDailyAccrual can repost cleanly.
    const [del] = await db.query(
      `DELETE FROM ledger_entries WHERE deal_number = ? AND description = ? AND DATE(entry_date) = ?`,
      [DEAL_NUMBER, `TBill Daily Accrual for Deal ${DEAL_NUMBER}`, day]
    );
    if (del.affectedRows) console.log(`${day}: deleted ${del.affectedRows} old row(s)`);

    const dealForDay = Object.assign({}, deal, { remaining_face_value: remaining });
    const result = await tbillLedgerService.postTbillDailyAccrual(dealForDay, day);
    console.log(`${day}: posted=${result.posted} amount=${result.amount ?? '-'} reason=${result.reason ?? result.skipped ?? ''}`);
  }

  // Recompute accrued_interest_to_date / per_day_accrual from the deal's TRUE current
  // remaining_face_value (8,000,000) after all backfill days are posted, since each
  // postTbillDailyAccrual call above used its own per-day override and left the row's
  // running totals reflecting only that call's local view.
  const [sumRows] = await db.query(
    `SELECT COALESCE(SUM(debit_amount), 0) AS total FROM ledger_entries
     WHERE deal_number = ? AND description = ? AND debit_amount > 0`,
    [DEAL_NUMBER, `TBill Daily Accrual for Deal ${DEAL_NUMBER}`]
  );
  const trueAccrued = Number(sumRows[0].total);
  const trueDailyRate = tbillLedgerService.computeTbillDailyAccrual(deal);
  await db.query('UPDATE tbill SET accrued_interest_to_date = ?, per_day_accrual = ? WHERE deal_number = ?', [
    trueAccrued.toFixed(8),
    trueDailyRate.ok ? trueDailyRate.amount.toFixed(8) : deal.per_day_accrual,
    DEAL_NUMBER
  ]);
  console.log(`\nSynced accrued_interest_to_date=${trueAccrued.toFixed(2)}, per_day_accrual=${trueDailyRate.ok ? trueDailyRate.amount.toFixed(2) : 'unchanged'}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e.message, e.stack);
  process.exit(1);
});
