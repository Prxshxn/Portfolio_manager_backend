'use strict';

/**
 * Backfill letter-only GSEC Buy (leg1) + Sell (leg2) for Buy/Sell buybacks
 * so Leg 1 / Leg 2 Letter buttons work on the final buyback blotter.
 *
 * Scope:
 *   - deal_status = 'Approved'
 *   - leg1_transaction_type = 'Buy' AND leg2_transaction_type = 'Sell'
 *   - approved from WINDOW_START (default 2026-07-01) onward
 *   - missing Buy and/or Sell letter GSEC linked via buyback_deal_id
 *
 * Does NOT deduct holdings or post ledger.
 *
 * SAFETY: dry-run by default. Pass --commit to write.
 *
 * Usage:
 *   node scripts/backfill-buysell-letter-gsec-july2026.js
 *   node scripts/backfill-buysell-letter-gsec-july2026.js --commit
 */

const db = require('../config/database');
const {
  createBuybackBuySellLetterGsecs
} = require('../services/buybackBuySellLetterGsecService');

const WINDOW_START = process.env.WINDOW_START || '2026-07-01';
const WINDOW_END = process.env.WINDOW_END || null;
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
    if (!colRows.length) {
      console.error('gsec.buyback_deal_id column missing — aborting.');
      process.exit(1);
    }

    console.log(
      `\n=== Buy/Sell letter GSEC backfill ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} ===`
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
        AND bd.leg1_transaction_type = 'Buy'
        AND bd.leg2_transaction_type = 'Sell'
        AND DATE(COALESCE(bd.approved_at, bd.leg1_value_date)) >= DATE(?)
        AND (
          NOT EXISTS (
            SELECT 1 FROM gsec g
            WHERE g.buyback_deal_id = bd.id
              AND g.transaction_type = 'Buy'
              AND COALESCE(g.status, '') <> 'cancelled'
          )
          OR NOT EXISTS (
            SELECT 1 FROM gsec g
            WHERE g.buyback_deal_id = bd.id
              AND g.transaction_type = 'Sell'
              AND COALESCE(g.status, '') <> 'cancelled'
          )
        )
    `;
    const params = [WINDOW_START];
    if (WINDOW_END) {
      sql += ' AND DATE(COALESCE(bd.approved_at, bd.leg1_value_date)) <= DATE(?)';
      params.push(WINDOW_END);
    }
    sql += ' ORDER BY COALESCE(bd.approved_at, bd.leg1_value_date) ASC, bd.id ASC';

    const [rows] = await db.query(sql, params);
    console.log(`Candidates missing letter GSEC row(s): ${rows.length}\n`);

    if (!rows.length) {
      console.log('Nothing to do.');
      process.exit(0);
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const buybackDeal of rows) {
      const effDate = buybackDeal.approved_at || buybackDeal.leg1_value_date;
      console.log(
        `- ${buybackDeal.deal_number} id=${buybackDeal.id} ` +
          `eff=${effDate && new Date(effDate).toISOString().slice(0, 10)} ` +
          `isin1=${buybackDeal.leg1_isin} isin2=${buybackDeal.leg2_isin}`
      );

      if (!COMMIT) {
        skipped += 1;
        continue;
      }

      const connection = await db.pool.getConnection();
      try {
        await connection.beginTransaction();
        const { buyId, sellId } = await createBuybackBuySellLetterGsecs({
          buybackDeal,
          buybackIdNum: buybackDeal.id,
          hasBuybackDealId: true,
          connection,
          userId: buybackDeal.approved_by || 1
        });
        await connection.commit();
        if (buyId || sellId) {
          created += 1;
          console.log(`  -> buyId=${buyId} sellId=${sellId}`);
        } else {
          skipped += 1;
          console.log('  -> skipped');
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
