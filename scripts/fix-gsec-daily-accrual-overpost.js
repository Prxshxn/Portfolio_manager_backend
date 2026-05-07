/**
 * One-time correction script for GSec daily accrual journals that were overposted
 * due to coupon_interest being treated as per-period when it was stored as annual.
 *
 * What it does:
 * - For a given entry date (calendar date), finds posted "GSec Daily Accrual for Deal X" journals.
 * - Recomputes the correct daily accrual for that same date using computeGsecPerDayAccrual().
 * - Posts an adjustment journal for the difference (overposted -> reverse the excess; underposted -> post the shortfall).
 * - Idempotent: will not post again if a correction for that deal+date already exists.
 *
 * Usage:
 *   node scripts/fix-gsec-daily-accrual-overpost.js --date=2026-05-06 --dry-run
 *   node scripts/fix-gsec-daily-accrual-overpost.js --date=2026-05-06
 *   node scripts/fix-gsec-daily-accrual-overpost.js --date=2026-05-06 --deal=20260421/GSEC/0003
 */
/* eslint-disable no-console */
'use strict';

const db = require('../config/database');
const ledgerController = require('../controllers/ledgerController');
const accountMapping = require('../services/accountMappingService');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const [k, vRaw] = a.slice(2).split('=');
    const v = vRaw === undefined ? true : vRaw;
    args[k] = v;
  }
  return args;
}

function toYmd(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}

function money(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

async function main() {
  const args = parseArgs(process.argv);
  const entryDate = args.date ? String(args.date) : null;
  const dealFilter = args.deal ? String(args.deal) : null;
  const dryRun = args['dry-run'] === true || String(args['dry-run']).toLowerCase() === 'true';

  if (!entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw new Error('Missing/invalid --date=YYYY-MM-DD');
  }

  const accrualAssetCode = await accountMapping.getAccountCode(
    accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET
  );
  const accrualIncomeCode = await accountMapping.getAccountCode(
    accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME
  );

  // Find posted accrual debit rows (one per deal per day).
  const whereDeal = dealFilter ? ' AND le.deal_number = ?' : '';
  const params = dealFilter ? [entryDate, dealFilter] : [entryDate];
  const [posted] = await db.query(
    `
    SELECT
      le.deal_number,
      SUM(le.debit_amount) AS posted_amount
    FROM ledger_entries le
    WHERE DATE(le.entry_date) = DATE(?)
      AND le.description LIKE 'GSec Daily Accrual for Deal %'
      AND le.debit_amount > 0
      ${whereDeal}
    GROUP BY le.deal_number
    `,
    params
  );

  console.log(`[fix-gsec-accrual] date=${entryDate} deals_found=${posted.length} dryRun=${dryRun}`);
  if (!posted.length) return;

  let corrected = 0;
  let skippedNoDiff = 0;
  let skippedAlreadyCorrected = 0;
  let errors = 0;

  for (const row of posted) {
    const dealNumber = String(row.deal_number);
    const postedAmount = money(row.posted_amount);

    try {
      const correctionDesc = `GSec Daily Accrual Correction for Deal ${dealNumber} (fix ${entryDate})`;
      const [alreadyRows] = await db.query(
        `SELECT 1 AS ok
         FROM ledger_entries
         WHERE DATE(entry_date) = DATE(?)
           AND deal_number = ?
           AND description = ?
         LIMIT 1`,
        [entryDate, dealNumber, correctionDesc]
      );
      if (alreadyRows && alreadyRows.length > 0) {
        skippedAlreadyCorrected++;
        continue;
      }

      const [gsecRows] = await db.query(
        `SELECT g.face_value, g.remaining_face_value, g.coupon_interest, g.maturity_date, g.isin_number,
                im.coupon_rate, im.coupon_date_1, im.coupon_date_2
         FROM gsec g
         LEFT JOIN isin_master im
           ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
         WHERE g.deal_number = ?
           AND g.transaction_type = 'Buy'
         LIMIT 1`,
        [dealNumber]
      );
      const deal = gsecRows && gsecRows[0];
      if (!deal) {
        console.warn(`[fix-gsec-accrual] missing gsec buy row for deal=${dealNumber}, skipping`);
        continue;
      }

      const computed = computeGsecPerDayAccrual(deal, entryDate, 2);
      if (!computed.ok) {
        console.warn(
          `[fix-gsec-accrual] cannot compute accrual for deal=${dealNumber}: ${computed.reason}, skipping`
        );
        continue;
      }

      const expected = money(computed.amount);
      const diff = round2(postedAmount - expected); // >0 means overposted
      if (Math.abs(diff) < 0.01) {
        skippedNoDiff++;
        continue;
      }

      // If we overposted, reverse the excess: Dr Income, Cr Asset.
      // If we underposted, post the shortfall: Dr Asset, Cr Income.
      const isOver = diff > 0;
      const adjAmount = Math.abs(diff);

      const entry = {
        date: entryDate,
        dr_account: isOver ? accrualIncomeCode : accrualAssetCode,
        cr_account: isOver ? accrualAssetCode : accrualIncomeCode,
        amount: adjAmount,
        deal_id: dealNumber,
        description: correctionDesc
      };

      console.log(
        `[fix-gsec-accrual] deal=${dealNumber} posted=${postedAmount} expected=${expected} diff=${diff} ` +
          `action=${isOver ? 'reverse_excess' : 'post_shortfall'} amount=${adjAmount}`
      );

      if (!dryRun) {
        const lr = await ledgerController.postLedgerEntry(entry);
        if (!lr || lr.success !== true) {
          throw new Error(lr && lr.error ? lr.error : 'unknown ledger post failure');
        }
      }

      corrected++;
    } catch (e) {
      errors++;
      console.error(`[fix-gsec-accrual] deal=${dealNumber} failed:`, e.message || e);
    }
  }

  console.log(
    `[fix-gsec-accrual] done date=${entryDate} corrected=${corrected} ` +
      `skipped_no_diff=${skippedNoDiff} skipped_already_corrected=${skippedAlreadyCorrected} errors=${errors}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[fix-gsec-accrual] fatal:', e.message || e);
    process.exit(1);
  });

