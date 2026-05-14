/**
 * Backfill gsec.per_day_accrual and number_of_days_for_coupon_period using the same
 * logic as EOD (maturity-based coupon period E, remaining-face scaling).
 * Does not post ledger entries.
 *
 * Usage (from Portfolio_manager_backend):
 *   node scripts/backfill-gsec-per-day-accrual.js
 *   node scripts/backfill-gsec-per-day-accrual.js --as-of=2026-04-01
 *   node scripts/backfill-gsec-per-day-accrual.js --as-of=2026-04-01 --execute
 *
 * Default --as-of: latest system_day from DB, else today's UTC date.
 *
 * Optional: --isin=LKB00931E153  or  --isin=LKB00931E153,LKB01534I155  (restrict to these ISINs)
 */

const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

function toYmd(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  let asOf = null;
  let isinFilter = null;
  for (const a of args) {
    if (a.startsWith('--as-of=')) {
      asOf = a.slice('--as-of='.length).trim();
    }
    if (a.startsWith('--isin=')) {
      isinFilter = a.slice('--isin='.length).trim().split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!asOf) {
    const sd = await getSystemDay();
    asOf = (sd && sd.system_date && toYmd(sd.system_date)) || new Date().toISOString().slice(0, 10);
  }

  let sql = `
    SELECT g.id, g.deal_number, g.coupon_interest, g.maturity_date, g.face_value, g.remaining_face_value,
           g.per_day_accrual, g.number_of_days_for_coupon_period, g.isin_number,
           COALESCE((
             SELECT SUM(s.face_value)
             FROM gsec s
             WHERE s.transaction_type = 'Sell'
               AND s.buy_deal_number IS NOT NULL
               AND TRIM(s.buy_deal_number) = TRIM(g.deal_number)
               AND s.value_date IS NOT NULL
               AND DATE(s.value_date) <= DATE(?)
           ), 0) AS linked_sold_face_value,
           im.coupon_date_1, im.coupon_date_2, im.coupon_rate
    FROM gsec g
    LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
    WHERE g.transaction_type = 'Buy'
      AND g.status = 'final_approved'
      AND g.maturity_date >= ?
      AND (g.coupon_interest IS NOT NULL AND g.coupon_interest > 0
           OR im.coupon_rate IS NOT NULL AND im.coupon_rate > 0)`;
  const params = [asOf, asOf];
  if (isinFilter && isinFilter.length > 0) {
    sql += ` AND g.isin_number IN (${isinFilter.map(() => '?').join(',')})`;
    params.push(...isinFilter);
  }
  const [rows] = await db.query(sql, params);

  // Aggregate per-Buy-deal buyback deductions so the safety guard in
  // computeGsecPerDayAccrual does not reset remaining_face_value back to face_value
  // for deals that were partially bought back (no Sell rows exist).
  const buybackByDeal = {};
  try {
    const buyDealNumbersForBB = (rows || [])
      .map((d) => String(d.deal_number || '').trim())
      .filter(Boolean);

    let hasSellDealAllocationsCol = false;
    let hasBBTransactionTypeCol = false;
    try {
      const [bbSchemaRows] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buyback_deals'
           AND COLUMN_NAME IN ('sell_deal_allocations', 'leg1_transaction_type')`
      );
      const cols = new Set((bbSchemaRows || []).map((r) => r.COLUMN_NAME));
      hasSellDealAllocationsCol = cols.has('sell_deal_allocations');
      hasBBTransactionTypeCol = cols.has('leg1_transaction_type');
    } catch (_) { /* leave defaults */ }

    if (buyDealNumbersForBB.length) {
      const ph = buyDealNumbersForBB.map(() => '?').join(',');
      let directBBSql = `
        SELECT TRIM(source_buy_deal_number) AS dn,
               COALESCE(SUM(leg1_face_value), 0) AS bb
        FROM buyback_deals
        WHERE deal_status = 'Approved'
          AND source_buy_deal_number IS NOT NULL
          AND TRIM(source_buy_deal_number) IN (${ph})
          AND approved_at IS NOT NULL
          AND DATE(approved_at) <= DATE(?)`;
      const directBBParams = [...buyDealNumbersForBB, asOf];
      if (hasBBTransactionTypeCol) directBBSql += ` AND leg1_transaction_type = 'Sell'`;
      directBBSql += ' GROUP BY TRIM(source_buy_deal_number)';
      const [directBBRows] = await db.query(directBBSql, directBBParams);
      directBBRows.forEach((r) => {
        const dn = String(r.dn || '').trim();
        if (dn) buybackByDeal[dn] = Number(r.bb) || 0;
      });

      if (hasSellDealAllocationsCol) {
        let allocBBSql = `
          SELECT sell_deal_allocations
          FROM buyback_deals
          WHERE deal_status = 'Approved'
            AND sell_deal_allocations IS NOT NULL
            AND approved_at IS NOT NULL
            AND DATE(approved_at) <= DATE(?)`;
        const allocBBParams = [asOf];
        if (hasBBTransactionTypeCol) allocBBSql += ` AND leg1_transaction_type = 'Sell'`;
        const [allocRows] = await db.query(allocBBSql, allocBBParams);
        const buyDealSet = new Set(buyDealNumbersForBB);
        for (const r of allocRows || []) {
          try {
            const allocs = typeof r.sell_deal_allocations === 'string'
              ? JSON.parse(r.sell_deal_allocations)
              : r.sell_deal_allocations;
            if (!Array.isArray(allocs)) continue;
            for (const a of allocs) {
              const dn = String((a && a.deal_number) || '').trim();
              const amt = Number(a && a.amountToSell) || 0;
              if (dn && amt > 0 && buyDealSet.has(dn)) {
                buybackByDeal[dn] = (buybackByDeal[dn] || 0) + amt;
              }
            }
          } catch (_) { /* ignore malformed JSON */ }
        }
      }
    }
  } catch (bbAggErr) {
    console.warn(
      `[backfill-per-day-accrual] failed to aggregate buyback (continuing with sells only): ${bbAggErr.message}`
    );
  }

  console.log(`as-of=${asOf}  isin=${isinFilter ? isinFilter.join(',') : 'all'}  rows=${rows.length}  execute=${execute}\n`);

  let updateCount = 0;
  for (const deal of rows) {
    const dnForBB = String(deal.deal_number || '').trim();
    deal.linked_buyback_face_value = Number(buybackByDeal[dnForBB] || 0);
    const computed = computeGsecPerDayAccrual(deal, asOf, 2);
    if (!computed.ok) {
      console.log(`SKIP ${deal.deal_number}: ${computed.reason}`);
      continue;
    }
    const { amount, E } = computed;
    const oldPd = deal.per_day_accrual;
    const oldNd = deal.number_of_days_for_coupon_period;
    console.log(
      `${deal.deal_number}  per_day ${oldPd} -> ${amount}  days_period ${oldNd} -> ${E}  isin=${deal.isin_number || ''}  linked_sold=${deal.linked_sold_face_value || 0}  linked_buyback=${deal.linked_buyback_face_value || 0}`
    );
    if (execute) {
      const ciToStore = computed.effectiveCouponInterest;
      const existingCi = Number(deal.coupon_interest);
      const needCiFix = !Number.isFinite(existingCi) || existingCi <= 0;
      if (needCiFix) {
        await db.query(
          `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ?, coupon_interest = ? WHERE id = ?`,
          [amount, E, ciToStore, deal.id]
        );
      } else {
        await db.query(
          `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?`,
          [amount, E, deal.id]
        );
      }
      updateCount += 1;
    }
  }

  if (execute) {
    console.log(`\nUpdated ${updateCount} row(s).`);
  } else {
    console.log('\nDry run. Re-run with --execute to apply UPDATEs.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
