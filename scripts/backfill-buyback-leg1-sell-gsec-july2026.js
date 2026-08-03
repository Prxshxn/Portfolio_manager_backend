'use strict';

/**
 * Backfill final_approved GSEC Sell rows for Sell/Buy buybacks (leg 1)
 * so settlement instruction letters can print from the GSEC letters panel.
 *
 * Scope:
 *   - deal_status = 'Approved'
 *   - leg1_transaction_type = 'Sell'
 *   - approved from WINDOW_START (default 2026-07-01) onward
 *     (falls back to leg1_value_date when approved_at is null)
 *   - no existing non-cancelled GSEC Sell with buyback_deal_id = this deal
 *
 * Does NOT re-deduct remaining_face or post BB-L1 ledger (already done on approval).
 *
 * SAFETY: dry-run by default. Pass --commit to write.
 *
 * Usage:
 *   node scripts/backfill-buyback-leg1-sell-gsec-july2026.js
 *   node scripts/backfill-buyback-leg1-sell-gsec-july2026.js --commit
 *   WINDOW_START=2026-07-01 WINDOW_END=2026-07-31 node scripts/backfill-buyback-leg1-sell-gsec-july2026.js --commit
 */

const db = require('../config/database');
const {
  createBuybackLeg1SellGsec,
  getLeg1EffectiveFace
} = require('../services/buybackLeg1SellGsecService');

const WINDOW_START = process.env.WINDOW_START || '2026-07-01';
const WINDOW_END = process.env.WINDOW_END || null; // inclusive; null = no upper bound
const COMMIT = process.argv.includes('--commit');

(async () => {
  try {
    const [colRows] = await db.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gsec'
        AND COLUMN_NAME = 'buyback_deal_id'
      LIMIT 1
    `);
    const hasBuybackDealId = Array.isArray(colRows) && colRows.length > 0;
    if (!hasBuybackDealId) {
      console.error('gsec.buyback_deal_id column missing — aborting.');
      process.exit(1);
    }

    console.log(
      `\n=== Buyback leg-1 GSEC Sell backfill ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} ===`
    );
    console.log(
      `Window: effective_date >= ${WINDOW_START}` +
        (WINDOW_END ? ` AND <= ${WINDOW_END}` : ' (no end)') +
        '\n'
    );

    let sql = `
      SELECT bd.*
      FROM buyback_deals bd
      WHERE bd.deal_status = 'Approved'
        AND bd.leg1_transaction_type = 'Sell'
        AND DATE(COALESCE(bd.approved_at, bd.leg1_value_date)) >= DATE(?)
        AND NOT EXISTS (
          SELECT 1 FROM gsec g
          WHERE g.transaction_type = 'Sell'
            AND g.buyback_deal_id = bd.id
            AND COALESCE(g.status, '') <> 'cancelled'
        )
    `;
    const params = [WINDOW_START];
    if (WINDOW_END) {
      sql += ' AND DATE(COALESCE(bd.approved_at, bd.leg1_value_date)) <= DATE(?)';
      params.push(WINDOW_END);
    }
    sql += ' ORDER BY COALESCE(bd.approved_at, bd.leg1_value_date) ASC, bd.id ASC';

    const [rows] = await db.query(sql, params);
    console.log(`Candidates missing Sell row: ${rows.length}\n`);

    if (!rows.length) {
      console.log('Nothing to do.');
      process.exit(0);
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const buybackDeal of rows) {
      const face = getLeg1EffectiveFace(buybackDeal);
      const effDate = buybackDeal.approved_at || buybackDeal.leg1_value_date;
      console.log(
        `- ${buybackDeal.deal_number} id=${buybackDeal.id} ` +
          `eff=${effDate && new Date(effDate).toISOString().slice(0, 10)} ` +
          `isin=${buybackDeal.leg1_isin} face=${face} ` +
          `settlement=${buybackDeal.leg1_settlement_amount} fm=${buybackDeal.fund_movement}`
      );

      if (!COMMIT) {
        skipped += 1;
        continue;
      }

      const connection = await db.pool.getConnection();
      try {
        await connection.beginTransaction();
        const gsecId = await createBuybackLeg1SellGsec({
          buybackDeal,
          buybackIdNum: buybackDeal.id,
          hasBuybackDealId: true,
          allocations: null,
          connection,
          userId: buybackDeal.approved_by || 1
        });
        await connection.commit();
        if (gsecId) {
          created += 1;
          console.log(`  -> created/existing gsec id=${gsecId}`);
        } else {
          skipped += 1;
          console.log('  -> skipped (no allocations / ISIN)');
        }
      } catch (err) {
        try {
          await connection.rollback();
        } catch (_) {
          /* ignore */
        }
        failed += 1;
        console.error(`  -> FAILED: ${err.message || err}`);
      } finally {
        connection.release();
      }
    }

    console.log(
      `\nDone. created=${created} skipped=${skipped} failed=${failed}` +
        (COMMIT ? '' : ' (re-run with --commit to write)')
    );
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Backfill aborted:', err);
    process.exit(1);
  }
})();
