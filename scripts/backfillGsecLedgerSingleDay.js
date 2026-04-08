/**
 * Post missing GSec daily accrual ledger lines for one deal and one calendar date.
 *
 * Usage:
 *   node scripts/backfillGsecLedgerSingleDay.js <deal_number> <YYYY-MM-DD>
 *   node scripts/backfillGsecLedgerSingleDay.js 20251106/GSEC/0002 2026-04-03
 *
 * Optional: --force  post even if some rows already exist for that deal/date (use after cleanup)
 */

const { query } = require('../config/database');
const { postLedgerEntry } = require('../controllers/ledgerController');
const accountMapping = require('../services/accountMappingService');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

function parseArgs() {
  const force = process.argv.includes('--force');
  const pos = process.argv.slice(2).filter((a) => a !== '--force');
  const dealNumber = pos[0];
  const asOfDate = pos[1];
  return { dealNumber, asOfDate, force };
}

async function main() {
  const { dealNumber, asOfDate, force } = parseArgs();
  if (!dealNumber || !asOfDate) {
    console.error('Usage: node scripts/backfillGsecLedgerSingleDay.js <deal_number> <YYYY-MM-DD> [--force]');
    process.exit(1);
  }

  const [rows] = await query(
    `SELECT g.id, g.deal_number, g.value_date, g.coupon_interest, g.maturity_date, g.face_value, g.remaining_face_value,
            g.isin_number, g.per_day_accrual,
            im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.deal_number = ?`,
    [dealNumber]
  );
  if (!rows.length) {
    console.error('Deal not found:', dealNumber);
    process.exit(1);
  }
  const deal = rows[0];

  const [existing] = await query(
    `SELECT COUNT(*) AS c FROM ledger_entries WHERE deal_number = ? AND DATE(entry_date) = ?`,
    [dealNumber, asOfDate]
  );
  const cnt = Number(existing[0].c) || 0;
  if (cnt >= 2 && !force) {
    console.log('Already has', cnt, 'ledger row(s) for', dealNumber, asOfDate, '- nothing to do (use --force to post anyway).');
    process.exit(0);
  }
  if (cnt > 0 && cnt < 2 && !force) {
    console.error(
      'Partial ledger rows (',
      cnt,
      ') for this date. Fix or delete them, or re-run with --force after cleanup.'
    );
    process.exit(1);
  }

  const computed = computeGsecPerDayAccrual(deal, asOfDate, 2);
  if (!computed.ok) {
    console.error('Cannot compute accrual:', computed.reason);
    process.exit(1);
  }

  const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
  const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);

  const result = await postLedgerEntry({
    date: asOfDate,
    dr_account: drAccount,
    cr_account: crAccount,
    amount: computed.amount,
    deal_id: deal.deal_number,
    description: `GSec Daily Accrual for Deal ${deal.deal_number} (backfill ${asOfDate})`
  });

  if (!result.success) {
    console.error('Ledger post failed:', result.error);
    process.exit(1);
  }
  console.log('Backfill OK:', {
    dealNumber,
    asOfDate,
    amount: computed.amount,
    E: computed.E
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
