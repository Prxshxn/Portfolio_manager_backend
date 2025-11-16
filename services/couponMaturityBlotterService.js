const db = require('../config/db');

/**
 * Get coupon maturity blotter data for a given coupon date
 * @param {string} couponDate - The coupon date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of coupon deals with transaction type and amounts
 */
exports.getCouponMaturityBlotter = async (couponDate) => {
  if (!couponDate) {
    throw new Error('Coupon date is required');
  }

  // Query gsec deals where next_coupon_date matches the input date
  // Also check isin_coupon_schedule for matching coupon dates
  // Include both Buy and Sell transactions
  const sql = `
    SELECT DISTINCT
      g.id,
      g.deal_number,
      g.transaction_type,
      g.isin,
      g.face_value,
      g.coupon_interest,
      g.next_coupon_date,
      g.last_coupon_date,
      g.maturity_date,
      g.counterparty,
      g.portfolio,
      g.value_date,
      g.trade_date,
      im.coupon_rate,
      im.coupon_date_1,
      im.coupon_date_2,
      -- Get counterparty name
      COALESCE(
        corp.short_name,
        ind.short_name,
        joint.short_name,
        g.counterparty
      ) as counterparty_name,
      -- Check if this is a final coupon (maturity date)
      CASE WHEN g.maturity_date = ? THEN 1 ELSE 0 END as is_maturity_coupon
    FROM gsec g
    LEFT JOIN isin_master im ON g.isin = im.isin_number
    LEFT JOIN counterparty_master_corporate corp ON CONCAT('c', corp.id) = g.counterparty
    LEFT JOIN counterparty_master_individual ind ON CONCAT('i', ind.id) = g.counterparty
    LEFT JOIN counterparty_master_joint joint ON CONCAT('j', joint.id) = g.counterparty
    WHERE g.status = 'approved'
      AND g.transaction_type IN ('Buy', 'Sell')
      AND (
        -- Match by next_coupon_date
        g.next_coupon_date = ?
        OR
        -- Match by coupon schedule
        EXISTS (
          SELECT 1 
          FROM isin_coupon_schedule ics 
          WHERE ics.isin = g.isin 
            AND DATE(ics.coupon_date) = ?
        )
        OR
        -- Match if coupon date is the maturity date (final coupon)
        (DATE(g.maturity_date) = ?)
      )
      AND DATE(g.maturity_date) >= ?
    ORDER BY g.transaction_type, g.deal_number
  `;

  const [rows] = await db.query(sql, [couponDate, couponDate, couponDate, couponDate, couponDate]);

  // Process the results and calculate coupon amounts
  const results = rows.map((row) => {
    let couponAmount = Number(row.coupon_interest) || 0;
    const isFinalCoupon = row.is_maturity_coupon === 1;

    // Check if this is the final coupon (maturity date)
    if (isFinalCoupon) {
      // For final coupon, calculate interest for the period from last coupon to maturity
      if (row.last_coupon_date) {
        const lastCoupon = new Date(row.last_coupon_date);
        const maturity = new Date(row.maturity_date);
        const daysDiff = Math.round((maturity - lastCoupon) / (1000 * 60 * 60 * 24));
        
        // Get coupon rate and calculate for the actual period
        const couponRate = Number(row.coupon_rate) || 0;
        if (couponRate > 0 && daysDiff > 0) {
          // Standard 6-month period is approximately 182.5 days
          const standardPeriod = 182.5;
          // Calculate coupon amount for the actual period
          const faceValue = Number(row.face_value) || 0;
          const standardCouponAmount = (faceValue * couponRate / 100 / 2);
          couponAmount = (standardCouponAmount * daysDiff) / standardPeriod;
        }
      } else {
        // If no last coupon date, use full 6-month coupon amount
        const couponRate = Number(row.coupon_rate) || 0;
        const faceValue = Number(row.face_value) || 0;
        couponAmount = (faceValue * couponRate / 100 / 2);
      }
    } else {
      // Regular 6-month coupon - use the stored coupon_interest
      couponAmount = Number(row.coupon_interest) || 0;
      
      // If coupon_interest is not set, calculate it from coupon rate
      if (couponAmount === 0 && row.coupon_rate) {
        const couponRate = Number(row.coupon_rate) || 0;
        const faceValue = Number(row.face_value) || 0;
        couponAmount = (faceValue * couponRate / 100 / 2);
      }
    }

    return {
      id: row.id,
      deal_number: row.deal_number,
      transaction_type: row.transaction_type, // 'Buy' or 'Sell'
      isin: row.isin,
      face_value: Number(row.face_value) || 0,
      coupon_amount: couponAmount,
      coupon_date: couponDate,
      next_coupon_date: row.next_coupon_date,
      last_coupon_date: row.last_coupon_date,
      maturity_date: row.maturity_date,
      is_final_coupon: isFinalCoupon,
      counterparty: row.counterparty,
      counterparty_name: row.counterparty_name || row.counterparty,
      portfolio: row.portfolio,
      value_date: row.value_date,
      trade_date: row.trade_date,
      coupon_rate: Number(row.coupon_rate) || 0
    };
  }));

  return results;
};

