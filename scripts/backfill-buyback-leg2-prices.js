/**
 * Backfill buyback_deals leg2_clean_price / leg2_dirty_price where stored as 0 or NULL
 * but leg2_settlement_amount and face value are present.
 *
 *   node scripts/backfill-buyback-leg2-prices.js           # dry run
 *   node scripts/backfill-buyback-leg2-prices.js --confirm # apply
 */

const db = require('../config/database');
const { deriveLeg2Prices, isUsablePricePer100, truncate4 } = require('../services/buybackLeg2PriceHelper');

const CONFIRM = process.argv.includes('--confirm');

function needsLeg2PriceFix(clean, dirty) {
  return !isUsablePricePer100(clean) || !isUsablePricePer100(dirty);
}

async function run() {
  const [rows] = await db.query(
    `SELECT id, deal_number,
            leg1_face_value, leg2_face_value,
            leg1_clean_price, leg1_dirty_price,
            leg2_clean_price, leg2_dirty_price,
            leg2_settlement_amount, leg2_accrued_interest
       FROM buyback_deals
      WHERE leg2_settlement_amount IS NOT NULL AND leg2_settlement_amount > 0
      ORDER BY id`
  );

  const toFix = rows.filter((row) => needsLeg2PriceFix(row.leg2_clean_price, row.leg2_dirty_price));
  console.log(`Found ${toFix.length} buyback deal(s) with missing or invalid leg2 prices`);
  let updated = 0;

  for (const row of toFix) {
    const { leg2CleanPrice, leg2DirtyPrice } = deriveLeg2Prices({
      leg1FaceValue: row.leg1_face_value,
      leg2FaceValue: row.leg2_face_value,
      leg1CleanPrice: row.leg1_clean_price,
      leg1DirtyPrice: row.leg1_dirty_price,
      leg2CleanPrice: row.leg2_clean_price,
      leg2DirtyPrice: row.leg2_dirty_price,
      leg2SettlementAmount: row.leg2_settlement_amount
    });

    if (!leg2DirtyPrice && !leg2CleanPrice) {
      console.log(`  skip ${row.deal_number}: cannot derive prices`);
      continue;
    }

    const needsClean = !isUsablePricePer100(row.leg2_clean_price) && leg2CleanPrice;
    const needsDirty = !isUsablePricePer100(row.leg2_dirty_price) && leg2DirtyPrice;
    const needsAccrued = Number(row.leg2_accrued_interest) > 1000;
    if (!needsClean && !needsDirty && !needsAccrued) continue;

    const accrued = needsAccrued && leg2DirtyPrice && leg2CleanPrice
      ? Math.max(0, truncate4(leg2DirtyPrice - leg2CleanPrice))
      : row.leg2_accrued_interest;

    console.log(
      `  ${row.deal_number}: clean ${row.leg2_clean_price} -> ${leg2CleanPrice}, dirty ${row.leg2_dirty_price} -> ${leg2DirtyPrice}` +
      (needsAccrued ? `, accrued ${row.leg2_accrued_interest} -> ${accrued}` : '')
    );

    if (CONFIRM) {
      await db.query(
        `UPDATE buyback_deals
            SET leg2_clean_price = ?,
                leg2_dirty_price = ?,
                leg2_accrued_interest = CASE WHEN ? THEN ? ELSE leg2_accrued_interest END
          WHERE id = ?`,
        [
          leg2CleanPrice || row.leg2_clean_price,
          leg2DirtyPrice || row.leg2_dirty_price,
          needsAccrued,
          accrued,
          row.id
        ]
      );
    }
    updated += 1;
  }

  console.log(CONFIRM ? `Updated ${updated} deal(s)` : `Would update ${updated} deal(s) (dry run — pass --confirm to apply)`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
