/**
 * Backfill missing GSec daily accrual ledger entries for a date range.
 *
 * For each eligible Buy deal, iterates from --from (default 2026-04-01) to the
 * current system day.  Days that already have accrual ledger rows are skipped.
 * Missing days get a Dr/Cr pair posted via the standard postLedgerEntry path.
 *
 * Usage:
 *   node scripts/backfill-gsec-accrual-range.js                       # dry-run, all deals, from 2026-04-01
 *   node scripts/backfill-gsec-accrual-range.js --execute              # actually post
 *   node scripts/backfill-gsec-accrual-range.js --from=2026-04-05
 *   node scripts/backfill-gsec-accrual-range.js --deals=20251111/GSEC/0001,20251028/GSEC/0002
 *   node scripts/backfill-gsec-accrual-range.js --execute --from=2026-04-01 --deals=20251111/GSEC/0001
 */

const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const { postLedgerEntry } = require('../controllers/ledgerController');
const accountMapping = require('../services/accountMappingService');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

const DEFAULT_FROM = '2026-04-01';

function toYmd(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  let from = DEFAULT_FROM;
  let dealFilter = null;
  for (const a of args) {
    if (a.startsWith('--from=')) {
      from = a.slice('--from='.length).trim();
    }
    if (a.startsWith('--deals=')) {
      dealFilter = a.slice('--deals='.length).trim().split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return { execute, from, dealFilter };
}

async function main() {
  const { execute, from, dealFilter } = parseArgs();

  const sd = await getSystemDay();
  const systemDay = (sd && sd.system_date && toYmd(sd.system_date)) || new Date().toISOString().slice(0, 10);

  console.log(`=== GSec Accrual Range Backfill ===`);
  console.log(`from=${from}  systemDay=${systemDay}  execute=${execute}  deals=${dealFilter ? dealFilter.join(',') : 'all'}\n`);

  let sql = `
    SELECT g.id, g.deal_number, g.value_date, g.coupon_interest, g.maturity_date,
           g.face_value, g.remaining_face_value, g.isin_number, g.per_day_accrual,
           im.coupon_date_1, im.coupon_date_2, im.coupon_rate
    FROM gsec g
    LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
    WHERE g.transaction_type = 'Buy'
      AND g.status = 'final_approved'
      AND g.maturity_date >= ?
      AND g.value_date IS NOT NULL
      AND DATE(g.value_date) <= DATE(?)
      AND (g.coupon_interest IS NOT NULL AND g.coupon_interest > 0
           OR im.coupon_rate IS NOT NULL AND im.coupon_rate > 0)`;
  const params = [systemDay, systemDay];

  if (dealFilter && dealFilter.length > 0) {
    sql += ` AND g.deal_number IN (${dealFilter.map(() => '?').join(',')})`;
    params.push(...dealFilter);
  }

  sql += ' ORDER BY g.deal_number';
  const [deals] = await db.query(sql, params);
  console.log(`Eligible deals: ${deals.length}\n`);

  const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
  const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);

  let totalPosted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalAmount = 0;

  for (const deal of deals) {
    const valueDate = toYmd(deal.value_date);
    const maturityDate = toYmd(deal.maturity_date);
    if (!valueDate || !maturityDate) {
      console.log(`SKIP ${deal.deal_number}: missing value_date or maturity_date`);
      continue;
    }

    const startDate = valueDate > from ? valueDate : from;
    if (startDate > systemDay) {
      console.log(`SKIP ${deal.deal_number}: start date ${startDate} > system day ${systemDay}`);
      continue;
    }

    const [existingRows] = await db.query(
      `SELECT DATE(entry_date) AS d, COUNT(*) AS c
       FROM ledger_entries
       WHERE deal_number = ? AND description LIKE '%Daily Accrual%'
       GROUP BY DATE(entry_date)`,
      [deal.deal_number]
    );
    const postedDates = new Set();
    for (const row of existingRows) {
      if (Number(row.c) >= 2) {
        postedDates.add(toYmd(row.d));
      }
    }

    let dealPosted = 0;
    let dealSkipped = 0;
    let dealFailed = 0;
    let dealAmount = 0;
    let currentDate = startDate;

    while (currentDate <= systemDay) {
      if (currentDate > maturityDate) break;

      if (postedDates.has(currentDate)) {
        dealSkipped++;
        currentDate = addDays(currentDate, 1);
        continue;
      }

      const computed = computeGsecPerDayAccrual(deal, currentDate, 2);
      if (!computed.ok) {
        currentDate = addDays(currentDate, 1);
        continue;
      }

      if (execute) {
        const result = await postLedgerEntry({
          date: currentDate,
          dr_account: drAccount,
          cr_account: crAccount,
          amount: computed.amount,
          deal_id: deal.deal_number,
          description: `GSec Daily Accrual for Deal ${deal.deal_number} (backfill ${currentDate})`
        });
        if (result.success) {
          dealPosted++;
          dealAmount += computed.amount;
        } else {
          console.error(`  FAIL ${deal.deal_number} ${currentDate}: ${result.error}`);
          dealFailed++;
        }
      } else {
        dealPosted++;
        dealAmount += computed.amount;
      }

      currentDate = addDays(currentDate, 1);
    }

    const alreadyLabel = dealSkipped > 0 ? `  already_posted=${dealSkipped}` : '';
    const failLabel = dealFailed > 0 ? `  FAILED=${dealFailed}` : '';
    console.log(
      `${deal.deal_number}  value_date=${valueDate}  range=${startDate}..${systemDay}` +
      `  ${execute ? 'posted' : 'would_post'}=${dealPosted}${alreadyLabel}${failLabel}` +
      `  amount=${dealAmount.toFixed(8)}`
    );

    totalPosted += dealPosted;
    totalSkipped += dealSkipped;
    totalFailed += dealFailed;
    totalAmount += dealAmount;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Deals processed: ${deals.length}`);
  console.log(`Days ${execute ? 'posted' : 'to post'}: ${totalPosted}`);
  console.log(`Days already posted (skipped): ${totalSkipped}`);
  if (totalFailed > 0) console.log(`Days FAILED: ${totalFailed}`);
  console.log(`Total accrual amount: ${totalAmount.toFixed(8)}`);
  if (!execute) {
    console.log(`\nDry run. Re-run with --execute to post ledger entries.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
