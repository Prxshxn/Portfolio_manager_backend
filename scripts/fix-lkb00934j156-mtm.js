/**
 * Fix LKB00934J156 trailing space in master/related tables and backfill
 * a mark_to_market row so repo valuation works.
 *
 *   node scripts/fix-lkb00934j156-mtm.js
 *   node scripts/fix-lkb00934j156-mtm.js --execute
 */
const db = require('../config/database');
const { getSystemDay } = require('../models/systemDayModel');
const markToMarketService = require('../services/markToMarketService');
const { pricePer100FromYield } = require('../utils/bondPricing');

const EXECUTE = process.argv.includes('--execute');
const TARGET = 'LKB00934J156';

async function main() {
  console.log(EXECUTE ? 'MODE: EXECUTE' : 'MODE: DRY-RUN');

  const [before] = await db.query(
    `SELECT id, isin_number, LENGTH(isin_number) AS len, series, coupon_rate,
            issue_date, maturity_date, coupon_date_1, coupon_date_2, isin_issuer
     FROM isin_master WHERE TRIM(isin_number) = ?`,
    [TARGET]
  );
  if (!before[0]) throw new Error(`isin_master row not found for ${TARGET}`);
  const im = before[0];
  console.log('isin_master before:', { id: im.id, isin: JSON.stringify(im.isin_number), len: im.len });

  // Latest traded yield for this ISIN (fallback if we need prices)
  const [priceRows] = await db.query(
    `SELECT dirty_price, clean_price, yield, value_date, deal_number
     FROM gsec
     WHERE TRIM(isin_number) = ?
       AND transaction_type = 'Buy'
       AND dirty_price IS NOT NULL AND dirty_price > 0
     ORDER BY value_date DESC, id DESC
     LIMIT 1`,
    [TARGET]
  );
  const latest = priceRows[0];
  console.log('Latest gsec price:', latest || 'none');

  const sys = await getSystemDay();
  const valueDate = new Date(sys.system_date).toISOString().slice(0, 10);
  const yieldRate = Number(latest?.yield) || 12.42;

  const pricing = pricePer100FromYield({
    couponRate: Number(im.coupon_rate),
    yieldRate,
    valueDate,
    maturityDate: im.maturity_date,
    issueDate: im.issue_date,
    couponDate1: im.coupon_date_1 || '',
    couponDate2: im.coupon_date_2 || ''
  });
  const dirtyPrice = parseFloat(pricing.dirtyPrice) || Number(latest?.dirty_price) || null;
  const cleanPrice = parseFloat(pricing.cleanPrice) || Number(latest?.clean_price) || null;
  console.log(`Pricing as at ${valueDate} @ yield ${yieldRate}: dirty=${dirtyPrice} clean=${cleanPrice}`);

  if (!dirtyPrice) throw new Error('Could not derive dirty price');

  const updates = [
    ['isin_master', 'isin_number'],
    ['gsec', 'isin_number'],
    ['repo_deal_isins', 'isin_number'],
    ['isin_coupon_schedule', 'isin']
  ];

  for (const [table, col] of updates) {
    const [cnt] = await db.query(
      `SELECT COUNT(*) AS n FROM \`${table}\`
       WHERE TRIM(\`${col}\`) = ?
         AND LENGTH(\`${col}\`) > LENGTH(TRIM(\`${col}\`))`,
      [TARGET]
    );
    console.log(`Would trim ${table}.${col}: ${cnt[0].n} row(s)`);
  }

  const [existingMtm] = await db.query(
    `SELECT id, isin_number, dirty_price FROM mark_to_market WHERE TRIM(isin_number) = ?`,
    [TARGET]
  );
  console.log('Existing MTM:', existingMtm[0] || 'none — will insert');

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to apply.');
    process.exit(0);
  }

  for (const [table, col] of updates) {
    const [res] = await db.query(
      `UPDATE \`${table}\` SET \`${col}\` = TRIM(\`${col}\`)
       WHERE TRIM(\`${col}\`) = ?
         AND LENGTH(\`${col}\`) > LENGTH(TRIM(\`${col}\`))`,
      [TARGET]
    );
    console.log(`Trimmed ${table}.${col}: affected ${res.affectedRows}`);
  }

  // Also trim any other isin_master rows with trailing spaces while we're here? No — scoped.

  await markToMarketService.upsertMarkToMarketRecord({
    series: String(im.series || `11.70%2034J`).trim(),
    isinNumber: TARGET,
    isinIssuer: im.isin_issuer || 'GOSL',
    maturityDate: im.maturity_date,
    buyingPrice: cleanPrice,
    sellingPrice: cleanPrice,
    averagePrice: cleanPrice,
    buyingYield: yieldRate,
    sellingYield: yieldRate,
    averageYield: yieldRate,
    dirtyPrice,
    excelSource: `backfill-from-gsec-${latest?.deal_number || 'manual'}-${valueDate}`
  });

  const [afterIm] = await db.query(
    `SELECT isin_number, LENGTH(isin_number) AS len FROM isin_master WHERE isin_number = ?`,
    [TARGET]
  );
  const [afterMtm] = await db.query(
    `SELECT isin_number, dirty_price, average_price, average_yield, excel_source
     FROM mark_to_market WHERE isin_number = ?`,
    [TARGET]
  );
  console.log('\nisin_master after:', afterIm[0]);
  console.log('mark_to_market after:', afterMtm[0]);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
