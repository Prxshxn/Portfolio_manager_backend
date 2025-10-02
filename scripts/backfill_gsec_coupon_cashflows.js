const db = require('../config/database');

async function main() {
  try {
    console.log('Starting GSEC coupon cashflow backfill...');

    // Fetch all GSEC Buy deals with ISIN and maturity
    const [deals] = await db.query(`
      SELECT id, isin, face_value, maturity_date, counterparty
      FROM gsec
      WHERE transaction_type = 'Buy' AND isin IS NOT NULL AND isin != ''
    `);

    let totalInserted = 0;
    let totalChecked = 0;

    for (const deal of deals) {
      totalChecked++;

      // Pull coupon schedule up to maturity
      const [coupons] = await db.query(`
        SELECT coupon_date, coupon_amount
        FROM isin_coupon_schedule
        WHERE isin = ? AND coupon_date <= ?
        ORDER BY coupon_date
      `, [deal.isin, deal.maturity_date]);

      for (const c of coupons) {
        const couponAmount = (parseFloat(c.coupon_amount || 0) * parseFloat(deal.face_value || 0)) / 100;
        if (!couponAmount || couponAmount <= 0) continue;

        const reference = `GSEC-${deal.id}-COUPON-${c.coupon_date}`; // date-scoped to avoid duplicates

        // Skip if already inserted
        const [exists] = await db.query(`
          SELECT id FROM cashflow_transactions WHERE reference_number = ? LIMIT 1
        `, [reference]);
        if (exists.length) continue;

        await db.query(`
          INSERT INTO cashflow_transactions
          (category_id, transaction_date, amount, flow_type, currency, description, reference_number, counterparty, status)
          SELECT id as category_id, ?, ?, 'inflow', 'LKR', ?, ?, ?, 'confirmed'
          FROM cashflow_categories
          WHERE name = 'Interest Income' AND is_active = TRUE
          LIMIT 1
        `, [
          c.coupon_date,
          couponAmount,
          `GSEC Coupon Payment - ISIN ${deal.isin}`,
          reference,
          deal.counterparty || null
        ]);

        totalInserted++;
        console.log(`Inserted coupon CF: deal ${deal.id} date ${c.coupon_date} amount ${couponAmount}`);
      }
    }

    console.log(JSON.stringify({ totalDealsChecked: totalChecked, totalInserted }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
}

main();


