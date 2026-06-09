/**
 * Fix duplicate deal_numbers for BUYBACK leg-2 BUY rows ONLY (Tier 1, low risk).
 *
 * Targets gsec rows where:
 *   - the deal_number is shared by >1 Buy row, AND
 *   - the row is a buyback leg-2 buy (buyback_deal_id IS NOT NULL), AND
 *   - the row has ZERO external references (no sells, no buyback source, no ledger
 *     entries, no sell_deal_allocations) -> safe to rename with a plain UPDATE.
 *
 * For each duplicate group the LOWEST id keeps the original number; the rest get
 * fresh, globally-collision-checked sequence numbers for that date.
 *
 * SAFETY: dry-run by default. Pass --commit to write. Refuses to rename any row
 * that has references (those belong to the riskier Tier-2 cascade work).
 */
const db = require('../config/database');
const COLL = 'COLLATE utf8mb4_unicode_ci';
const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMMIT = process.argv.includes('--commit');

async function refsFor(dealNumber) {
  const [sells] = await db.query(`SELECT COUNT(*) c FROM gsec WHERE transaction_type='Sell' AND buy_deal_number = ?`, [dealNumber]);
  const [bbSrc] = await db.query(`SELECT COUNT(*) c FROM buyback_deals WHERE source_buy_deal_number = ?`, [dealNumber]);
  const [led]   = await db.query(`SELECT COUNT(*) c FROM ledger_entries WHERE deal_number ${COLL} = ? ${COLL}`, [dealNumber]);
  let allocs = 0;
  try { const [a] = await db.query(`SELECT COUNT(*) c FROM buyback_deals WHERE sell_deal_allocations LIKE ?`, [`%${dealNumber}%`]); allocs = a[0].c; } catch (_) {}
  return { sells: sells[0].c, bbSrc: bbSrc[0].c, ledger: led[0].c, allocs, total: sells[0].c + bbSrc[0].c + led[0].c + allocs };
}

(async () => {
  try {
    // Duplicate deal_numbers that involve at least one buyback leg-2 buy row.
    const [groups] = await db.query(
      `SELECT deal_number, COUNT(*) cnt
       FROM gsec
       WHERE deal_number IN (
         SELECT deal_number FROM gsec WHERE transaction_type='Buy' AND buyback_deal_id IS NOT NULL
       )
       GROUP BY deal_number HAVING COUNT(*) > 1
       ORDER BY deal_number`
    );

    console.log(`\n=== Tier-1 buyback duplicate fix ${COMMIT ? '(COMMIT - WILL WRITE)' : '(DRY RUN - no writes)'} ===`);
    console.log(`Buyback-involved duplicate groups: ${groups.length}\n`);
    if (!groups.length) { console.log('Nothing to do.'); process.exit(0); }

    const plan = [];
    let blocked = 0;

    for (const g of groups) {
      const [rows] = await db.query(
        `SELECT id, deal_number, transaction_type, buyback_deal_id, isin_number, face_value, value_date
         FROM gsec WHERE deal_number = ? ORDER BY id`, [g.deal_number]
      );
      const datePrefix = String(g.deal_number).split('/')[0];

      // Build globally-used seq set for this date (independent of group), so we never collide.
      const [existing] = await db.query(`SELECT deal_number FROM gsec WHERE deal_number LIKE ?`, [`${datePrefix}/GSEC/%`]);
      const usedSeqs = new Set();
      existing.forEach(r => { const s = parseInt(String(r.deal_number).split('/')[2], 10); if (!isNaN(s)) usedSeqs.add(s); });
      let cursor = 0;
      const nextSeq = () => { do { cursor += 1; } while (usedSeqs.has(cursor)); usedSeqs.add(cursor); return cursor; };

      const keeper = rows[0];
      console.log(`----- ${g.deal_number} (x${g.cnt}) -----`);
      console.log(`  KEEP id=${keeper.id} tx=${keeper.transaction_type} bb=${keeper.buyback_deal_id} face=${fmt(keeper.face_value)} value=${String(keeper.value_date).slice(0,10)}`);

      for (const r of rows.slice(1)) {
        const refs = await refsFor(r.deal_number);
        // Only rename SAFE buyback buy rows. Refuse anything with references.
        if (r.transaction_type !== 'Buy' || r.buyback_deal_id == null || refs.total > 0) {
          blocked++;
          console.log(`  SKIP id=${r.id} tx=${r.transaction_type} bb=${r.buyback_deal_id} (refs s=${refs.sells} bb=${refs.bbSrc} led=${refs.ledger} alloc=${refs.allocs}) -> Tier-2 / manual`);
          continue;
        }
        const seq = nextSeq();
        const newNum = `${datePrefix}/GSEC/${String(seq).padStart(4, '0')}`;
        console.log(`  RENAME id=${r.id} ${r.deal_number} -> ${newNum} (face ${fmt(r.face_value)}, value ${String(r.value_date).slice(0,10)}, 0 refs)`);
        plan.push({ id: r.id, old: r.deal_number, new: newNum });
      }
    }

    console.log(`\nPlanned safe renames: ${plan.length}   |   Skipped (need Tier-2/manual): ${blocked}`);

    if (COMMIT && plan.length) {
      let done = 0;
      for (const p of plan) {
        // Final guard: ensure target number is still free and source still has no refs.
        const [clash] = await db.query(`SELECT COUNT(*) c FROM gsec WHERE deal_number = ?`, [p.new]);
        if (clash[0].c > 0) { console.log(`  ABORT ${p.old}->${p.new}: target now exists.`); continue; }
        const refs = await refsFor(p.old);
        if (refs.total > 0) { console.log(`  ABORT ${p.old} id=${p.id}: references appeared.`); continue; }
        await db.query(`UPDATE gsec SET deal_number = ? WHERE id = ? AND deal_number = ?`, [p.new, p.id, p.old]);
        done++;
        console.log(`  WROTE id=${p.id}: ${p.old} -> ${p.new}`);
      }
      console.log(`\nCommitted ${done} rename(s).`);
    } else if (!COMMIT) {
      console.log(`\nDRY RUN - nothing written. Re-run with --commit to apply.`);
    }
  } catch (e) {
    console.error('ERROR:', e.message, e.stack);
  } finally { process.exit(0); }
})();
