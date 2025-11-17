const db = require('../config/db');

/**
 * Get coupon maturity blotter data for a given coupon date
 * @param {string} couponDate - The coupon date in YYYY-MM-DD format
 * @param {string} counterparty - Optional counterparty unique_id to filter by
 * @returns {Promise<Array>} Array of coupon deals with transaction type and amounts
 */
exports.getCouponMaturityBlotter = async (couponDate, counterparty = null) => {
  if (!couponDate) {
    throw new Error('Coupon date is required');
  }

  console.log(`[Coupon Maturity Blotter] Fetching data for coupon date: ${couponDate}${counterparty ? `, counterparty: ${counterparty}` : ''}`);

  // Query gsec deals that have a coupon payment on the selected date
  // A deal qualifies if:
  // 1. The coupon date exists in isin_coupon_schedule for that ISIN
  // 2. The deal's value_date is before or equal to the coupon date (deal was active)
  // 3. The deal's maturity_date is after or equal to the coupon date (deal hasn't matured yet)
  // 4. OR the coupon date is the maturity date (final coupon)
  const counterpartyFilter = counterparty ? 'AND g.counterparty = ?' : '';
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
      CASE WHEN DATE(g.maturity_date) = ? THEN 1 ELSE 0 END as is_maturity_coupon
    FROM gsec g
    LEFT JOIN isin_master im ON g.isin = im.isin_number
    LEFT JOIN counterparty_master_corporate corp ON CONCAT('c', corp.id) = g.counterparty
    LEFT JOIN counterparty_master_individual ind ON CONCAT('i', ind.id) = g.counterparty
    LEFT JOIN counterparty_master_joint joint ON CONCAT('j', joint.id) = g.counterparty
    WHERE g.status IN ('approved', 'pending', 'verified', 'settled')
      AND g.transaction_type IN ('Buy', 'Sell')
      AND DATE(g.value_date) <= ?
      AND DATE(g.maturity_date) >= ?
      ${counterpartyFilter}
      AND (
        -- Match if coupon date exists in the coupon schedule for this ISIN
        EXISTS (
          SELECT 1 
          FROM isin_coupon_schedule ics 
          WHERE ics.isin = g.isin 
            AND DATE(ics.coupon_date) = ?
        )
        OR
        -- Match if coupon date is the maturity date (final coupon)
        (DATE(g.maturity_date) = ?)
        OR
        -- Match by next_coupon_date (for backward compatibility)
        (DATE(g.next_coupon_date) = ?)
        OR
        -- Fallback: Match if coupon date matches coupon_date_1 or coupon_date_2 pattern from isin_master
        -- Check if month and day match (handles recurring annual coupon dates)
        (
          im.coupon_date_1 IS NOT NULL 
          AND MONTH(?) = MONTH(im.coupon_date_1)
          AND DAY(?) = DAY(im.coupon_date_1)
        )
        OR
        (
          im.coupon_date_2 IS NOT NULL 
          AND MONTH(?) = MONTH(im.coupon_date_2)
          AND DAY(?) = DAY(im.coupon_date_2)
        )
      )
    ORDER BY g.transaction_type, g.deal_number
  `;

  // Build parameters array dynamically
  const params = [
    couponDate, // 1. for is_maturity_coupon check (CASE WHEN)
    couponDate, // 2. for value_date <=
    couponDate, // 3. for maturity_date >=
  ];
  
  // Add counterparty parameter if provided
  if (counterparty) {
    params.push(counterparty); // 4. for counterparty filter
  }
  
  // Add remaining coupon date parameters
  params.push(
    couponDate, // for isin_coupon_schedule check (EXISTS)
    couponDate, // for maturity_date = (final coupon)
    couponDate, // for next_coupon_date =
    couponDate, // for MONTH(coupon_date_1)
    couponDate, // for DAY(coupon_date_1)
    couponDate, // for MONTH(coupon_date_2)
    couponDate  // for DAY(coupon_date_2)
  );

  const [rows] = await db.query(sql, params);

  console.log(`[Coupon Maturity Blotter] Found ${rows.length} deals for coupon date ${couponDate}`);

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
  });

  console.log(`[Coupon Maturity Blotter] Processed ${results.length} results`);
  return results;
};

