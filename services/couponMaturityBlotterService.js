const db = require('../config/db');

/**
 * Get coupon maturity blotter data for a given date range
 * @param {string} startDate - The start date in YYYY-MM-DD format
 * @param {string} endDate - The end date in YYYY-MM-DD format
 * @param {string} counterparty - Optional counterparty unique_id to filter by
 * @returns {Promise<Array>} Array of coupon deals with transaction type and amounts
 */
exports.getCouponMaturityBlotter = async (startDate, endDate, counterparty = null) => {
  if (!startDate || !endDate) {
    throw new Error('Start date and end date are required');
  }

  console.log(`[Coupon Maturity Blotter] Fetching data for date range: ${startDate} to ${endDate}${counterparty ? `, counterparty: ${counterparty}` : ''}`);

  // Query gsec deals that have a coupon payment within the selected date range
  // A deal qualifies if:
  // 1. The coupon date exists in isin_coupon_schedule for that ISIN and falls within the date range
  // 2. The deal's value_date is before or equal to the end date (deal was active)
  // 3. The deal's maturity_date is after or equal to the start date (deal hasn't matured yet)
  // 4. OR the maturity date falls within the date range (final coupon)
  const counterpartyFilter = counterparty ? 'AND g.counterparty_id = ?' : '';
  const sql = `
    SELECT DISTINCT
      g.id,
      g.deal_number,
      g.transaction_type,
      g.isin_number AS isin,
      g.face_value,
      g.remaining_face_value,
      g.coupon_interest,
      g.next_coupon_date,
      g.last_coupon_date,
      g.maturity_date,
      g.counterparty_id,
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
        CONCAT('ID:', g.counterparty_id)
      ) as counterparty_name,
      -- Check if this is a final coupon (maturity date falls within range)
      CASE WHEN DATE(g.maturity_date) BETWEEN ? AND ? THEN 1 ELSE 0 END as is_maturity_coupon,
      -- Get the actual coupon date for this deal (from schedule, maturity, or next_coupon_date)
      COALESCE(
        (SELECT DATE(ics.coupon_date) FROM isin_coupon_schedule ics 
         WHERE ics.isin COLLATE utf8mb4_unicode_ci = g.isin_number COLLATE utf8mb4_unicode_ci
           AND DATE(ics.coupon_date) BETWEEN ? AND ? 
         LIMIT 1),
        CASE WHEN DATE(g.maturity_date) BETWEEN ? AND ? THEN DATE(g.maturity_date) ELSE NULL END,
        CASE WHEN DATE(g.next_coupon_date) BETWEEN ? AND ? THEN DATE(g.next_coupon_date) ELSE NULL END
      ) as coupon_date
    FROM gsec g
    LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
    LEFT JOIN counterparty_master_corporate corp ON (g.counterparty_id LIKE 'c%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = corp.id) OR (g.counterparty_id = corp.id)
    LEFT JOIN counterparty_master_individual ind ON (g.counterparty_id LIKE 'i%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = ind.id) OR (g.counterparty_id = ind.id)
    LEFT JOIN counterparty_master_joint joint ON (g.counterparty_id LIKE 'j%' AND CAST(SUBSTRING(g.counterparty_id, 2) AS UNSIGNED) = joint.id) OR (g.counterparty_id = joint.id)
    WHERE g.status IN ('approved', 'final_approved', 'pending', 'verified', 'settled')
      AND g.transaction_type IN ('Buy', 'Sell')
      AND DATE(g.value_date) <= ?
      AND DATE(g.maturity_date) >= ?
      ${counterpartyFilter}
      AND (
        -- Match if coupon date exists in the coupon schedule for this ISIN within date range
        EXISTS (
          SELECT 1 
          FROM isin_coupon_schedule ics 
          WHERE ics.isin COLLATE utf8mb4_unicode_ci = g.isin_number COLLATE utf8mb4_unicode_ci
            AND DATE(ics.coupon_date) BETWEEN ? AND ?
        )
        OR
        -- Match if maturity date falls within the date range (final coupon)
        (DATE(g.maturity_date) BETWEEN ? AND ?)
        OR
        -- Match by next_coupon_date if it falls within the date range
        (DATE(g.next_coupon_date) BETWEEN ? AND ?)
      )
    ORDER BY g.transaction_type, g.deal_number
  `;

  // Build parameters array dynamically
  const params = [
    startDate, endDate, // 1-2. for is_maturity_coupon check (CASE WHEN BETWEEN)
    startDate, endDate, // 3-4. for coupon_date COALESCE (isin_coupon_schedule)
    startDate, endDate, // 5-6. for coupon_date COALESCE (maturity_date)
    startDate, endDate, // 7-8. for coupon_date COALESCE (next_coupon_date)
    endDate, // 9. for value_date <=
    startDate, // 10. for maturity_date >=
  ];
  
  // Add counterparty parameter if provided
  if (counterparty) {
    params.push(counterparty); // for counterparty filter
  }
  
  // Add remaining date range parameters for WHERE clause
  params.push(
    startDate, endDate, // for isin_coupon_schedule EXISTS (BETWEEN)
    startDate, endDate, // for maturity_date BETWEEN
    startDate, endDate  // for next_coupon_date BETWEEN
  );

  const [rows] = await db.query(sql, params);

  console.log(`[Coupon Maturity Blotter] Found ${rows.length} deals for date range ${startDate} to ${endDate}`);

  // Process the results and calculate coupon amounts
  const results = rows.map((row) => {
    let couponAmount = Number(row.coupon_interest) || 0;
    const isFinalCoupon = row.is_maturity_coupon === 1;
    const effectiveFaceValue = Math.max(0, Number(row.remaining_face_value || row.face_value) || 0);

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
          const faceValue = effectiveFaceValue;
          const standardCouponAmount = (faceValue * couponRate / 100 / 2);
          couponAmount = (standardCouponAmount * daysDiff) / standardPeriod;
        }
      } else {
        // If no last coupon date, use full 6-month coupon amount
        const couponRate = Number(row.coupon_rate) || 0;
        const faceValue = effectiveFaceValue;
        couponAmount = (faceValue * couponRate / 100 / 2);
      }
    } else {
      // Regular 6-month coupon - use the stored coupon_interest
      couponAmount = Number(row.coupon_interest) || 0;
      
      // If coupon_interest is not set, calculate it from coupon rate
      if (couponAmount === 0 && row.coupon_rate) {
        const couponRate = Number(row.coupon_rate) || 0;
        const faceValue = effectiveFaceValue;
        couponAmount = (faceValue * couponRate / 100 / 2);
      } else {
        const originalFace = Number(row.face_value) || 0;
        if (originalFace > 0 && effectiveFaceValue >= 0) {
          couponAmount = couponAmount * (effectiveFaceValue / originalFace);
        }
      }
    }

    return {
      id: row.id,
      deal_number: row.deal_number,
      transaction_type: row.transaction_type, // 'Buy' or 'Sell'
      isin: row.isin,
      face_value: Number(row.face_value) || 0,
      remaining_face_value: effectiveFaceValue,
      coupon_amount: couponAmount,
      coupon_date: row.coupon_date || null, // The actual coupon date within the range
      next_coupon_date: row.next_coupon_date,
      last_coupon_date: row.last_coupon_date,
      maturity_date: row.maturity_date,
      is_final_coupon: isFinalCoupon,
      counterparty: row.counterparty_id,
      counterparty_name: row.counterparty_name || row.counterparty_id,
      portfolio: row.portfolio,
      value_date: row.value_date,
      trade_date: row.trade_date,
      coupon_rate: Number(row.coupon_rate) || 0
    };
  }).filter((row) => {
    if (row.transaction_type !== 'Buy') {
      return true;
    }
    return Number(row.remaining_face_value || 0) > 0;
  });

  console.log(`[Coupon Maturity Blotter] Processed ${results.length} results`);
  return results;
};

