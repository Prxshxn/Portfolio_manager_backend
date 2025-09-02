// Bond pricing helper for backend mark-to-market calculations
// Simplified version without frontend dependencies

/**
 * Calculate days difference between two dates
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} Days difference
 */
function getDaysDifference(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
  return Math.round((date1 - date2) / oneDay);
}

/**
 * Format date to YYYY-MM-DD string
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') return date;
  if (date instanceof Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

/**
 * Parse coupon date string (MM-DD format) and return Date object
 * @param {string} couponDateStr - Date string in MM-DD format
 * @param {number} year - Year to use
 * @returns {Date} Parsed date
 */
function parseCouponDate(couponDateStr, year) {
  if (!couponDateStr || !year) return null;
  const [month, day] = couponDateStr.split('-');
  if (!month || !day) return null;
  return new Date(year, parseInt(month) - 1, parseInt(day));
}

/**
 * Compute per-100 clean/dirty/accrued from yield using Actual/Actual and semi-annual coupons
 * @param {Object} params - Calculation parameters
 * @param {number|string} params.couponRate - Annual coupon rate (percentage)
 * @param {number|string} params.yieldRate - Annual yield rate (percentage)
 * @param {string} params.valueDate - Value date (YYYY-MM-DD)
 * @param {string} params.issueDate - Issue date (YYYY-MM-DD)
 * @param {string} params.maturityDate - Maturity date (YYYY-MM-DD)
 * @param {string} params.couponDate1 - First coupon date (MM-DD)
 * @param {string} params.couponDate2 - Second coupon date (MM-DD)
 * @returns {Object} Pricing results
 */
function pricePer100FromYield({ couponRate, yieldRate, valueDate, issueDate, maturityDate, couponDate1, couponDate2 }) {
  if (!couponRate || !yieldRate || !valueDate || !maturityDate || !issueDate || !couponDate1 || !couponDate2) {
    return { dirtyPrice: '', cleanPrice: '', accruedInterestPer100: '' };
  }

  try {
    // Fixed semi-annual frequency
    const frequency = 2;
    const fv = 100; // per 100 basis
    const cr = parseFloat(couponRate) / 100;
    const ytm = parseFloat(yieldRate) / 100;
    const settle = new Date(valueDate);
    const issue = new Date(issueDate);
    const maturity = new Date(maturityDate);

    const coupon = fv * cr / frequency;
    const ytmPerPeriod = ytm / frequency;
    const monthsPerPeriod = 12 / frequency;

    // Step 1: Find last and next coupon dates precisely
    let lastCoupon = new Date(issue);

    // Move forward until we're past the value date
    while (lastCoupon <= settle) {
      lastCoupon.setMonth(lastCoupon.getMonth() + monthsPerPeriod);
    }

    // Step back to get the last coupon date before value date
    lastCoupon.setMonth(lastCoupon.getMonth() - monthsPerPeriod);

    // Create next coupon date by adding one period to last coupon
    const nextCoupon = new Date(lastCoupon);
    nextCoupon.setMonth(nextCoupon.getMonth() + monthsPerPeriod);

    // Calculate exact days in current coupon period using Actual/Actual day count
    const daysInPeriod = getDaysDifference(nextCoupon, lastCoupon);
    const daysToNextCoupon = getDaysDifference(nextCoupon, settle);
    const fractionalPeriod = daysToNextCoupon / daysInPeriod;

    // Step 2: Generate all future cash flows from next coupon to maturity
    const cashFlows = [];
    let cfDate = new Date(nextCoupon);
    let periodCount = 0;

    while (cfDate <= maturity) {
      const isFinal = cfDate.getTime() === maturity.getTime();
      const amount = isFinal ? coupon + fv : coupon;
      cashFlows.push({
        date: new Date(cfDate),
        amount,
        periodCount
      });
      cfDate.setMonth(cfDate.getMonth() + monthsPerPeriod);
      periodCount++;
    }

    // Step 3: Calculate PV of each cash flow using Actual/Actual day count basis and precise t values
    let dirtyPrice = 0;
    for (const cf of cashFlows) {
      // Calculate precise t = fractionalPeriod + integer number of periods
      const t = fractionalPeriod + cf.periodCount;
      
      // Calculate present value using the precise t value and semi-annual discounting
      const pv = cf.amount / Math.pow(1 + ytmPerPeriod, t);
      dirtyPrice += pv;
    }

    // Fix for floating point precision issues before truncating
    const dirtyPrice10000 = Math.floor(dirtyPrice * 10000 + 0.0001);
    const truncatedDirtyPrice = dirtyPrice10000 / 10000;

    // Calculate accrued interest (per 100)
    const daysAccrued = getDaysDifference(settle, lastCoupon);
    const accruedInterest = coupon * (daysAccrued / daysInPeriod);
    const truncatedAccruedInterestPer100 = Math.floor(accruedInterest * 10000) / 10000;

    // Clean price is dirty price minus accrued interest (all per 100)
    const cleanPrice = truncatedDirtyPrice - truncatedAccruedInterestPer100;
    const truncatedCleanPrice = Math.floor(cleanPrice * 10000) / 10000;

    return {
      dirtyPrice: truncatedDirtyPrice.toFixed(4),
      cleanPrice: truncatedCleanPrice.toFixed(4),
      accruedInterestPer100: truncatedAccruedInterestPer100.toFixed(4)
    };

  } catch (error) {
    console.error('Error in pricePer100FromYield:', error);
    return { dirtyPrice: '', cleanPrice: '', accruedInterestPer100: '' };
  }
}

/**
 * Reverse: from settlement amount and yield to face value
 * @param {Object} params - Calculation parameters
 * @returns {Object} Face value calculation results
 */
function faceValueFromSettlement({ settlementAmount, couponRate, yieldRate, valueDate, issueDate, maturityDate, couponDate1, couponDate2 }) {
  const { dirtyPrice, cleanPrice, accruedInterestPer100 } = pricePer100FromYield({ couponRate, yieldRate, valueDate, issueDate, maturityDate, couponDate1, couponDate2 });
  const dirty = parseFloat(dirtyPrice);
  if (!dirty || isNaN(dirty)) {
    return { faceValue: '', dirtyPricePer100: '', cleanPricePer100: '', accruedInterestPer100: '' };
  }
  
  // Calculate face value using the same formula as GSec form's settlement amount calculation
  // GSec: settlementAmount = (faceValue * dirtyPrice / 100)
  // So: faceValue = (settlementAmount * 100) / dirtyPrice
  const fv = (Number(settlementAmount) * 100) / dirty;
  
  return {
    faceValue: isFinite(fv) ? fv.toFixed(2) : '',
    dirtyPricePer100: dirtyPrice,
    cleanPricePer100: cleanPrice,
    accruedInterestPer100
  };
}

/**
 * Forward: from face value and settlement amount to yield (using bisection method for better stability)
 * @param {Object} params - Calculation parameters
 * @returns {Object} Yield calculation results
 */
function yieldFromFaceValueAndSettlement({ faceValue, settlementAmount, couponRate, valueDate, issueDate, maturityDate, couponDate1, couponDate2 }) {
  if (!faceValue || !settlementAmount || !couponRate || !valueDate || !issueDate || !maturityDate || !couponDate1 || !couponDate2) {
    return { yieldRate: '', dirtyPrice: '', cleanPrice: '', accruedInterestPer100: '' };
  }

  const fv = parseFloat(faceValue);
  const settlement = parseFloat(settlementAmount);
  
  if (!fv || !settlement || isNaN(fv) || isNaN(settlement)) {
    return { yieldRate: '', dirtyPrice: '', cleanPrice: '', accruedInterestPer100: '' };
  }

  // Target dirty price per 100 = (settlement * 100) / faceValue
  const targetDirtyPricePer100 = (settlement * 100) / fv;

  // Use bisection method for more stable convergence
  let yieldLow = 0.001; // 0.1% minimum yield
  let yieldHigh = 0.50;  // 50% maximum yield
  const tolerance = 0.0001; // 0.01% tolerance
  const maxIterations = 100;

  // Helper function to get price for a given yield
  const getPriceForYield = (yieldRate) => {
    const result = pricePer100FromYield({
      couponRate,
      yieldRate: yieldRate * 100, // Convert to percentage
      valueDate,
      issueDate,
      maturityDate,
      couponDate1,
      couponDate2
    });
    return parseFloat(result.dirtyPrice);
  };

  // Check if target is within bounds
  const priceLow = getPriceForYield(yieldLow);
  const priceHigh = getPriceForYield(yieldHigh);
  
  if (isNaN(priceLow) || isNaN(priceHigh)) {
    return { yieldRate: '', dirtyPrice: '', cleanPrice: '', accruedInterestPer100: '' };
  }

  // Bisection method
  for (let i = 0; i < maxIterations; i++) {
    const yieldMid = (yieldLow + yieldHigh) / 2;
    const priceMid = getPriceForYield(yieldMid);
    
    if (isNaN(priceMid)) {
      break;
    }

    const priceDiff = priceMid - targetDirtyPricePer100;
    
    if (Math.abs(priceDiff) < tolerance) {
      // Found the yield! Get the final result with all pricing details
      const finalResult = pricePer100FromYield({
        couponRate,
        yieldRate: yieldMid * 100,
        valueDate,
        issueDate,
        maturityDate,
        couponDate1,
        couponDate2
      });
      
      return {
        yieldRate: (yieldMid * 100).toFixed(6), // Convert back to percentage
        dirtyPrice: finalResult.dirtyPrice,
        cleanPrice: finalResult.cleanPrice,
        accruedInterestPer100: finalResult.accruedInterestPer100
      };
    }

    // Update bounds for next iteration
    // Since higher yield typically means lower price (inverse relationship)
    if (priceMid > targetDirtyPricePer100) {
      yieldLow = yieldMid; // Need higher yield to get lower price
    } else {
      yieldHigh = yieldMid; // Need lower yield to get higher price
    }
    
    // Prevent infinite loop if bounds become too close
    if (Math.abs(yieldHigh - yieldLow) < 0.000001) {
      break;
    }
  }

  // If we didn't converge, return the best guess
  const finalYield = (yieldLow + yieldHigh) / 2;
  const finalResult = pricePer100FromYield({
    couponRate,
    yieldRate: finalYield * 100,
    valueDate,
    issueDate,
    maturityDate,
    couponDate1,
    couponDate2
  });
  
  return {
    yieldRate: (finalYield * 100).toFixed(6),
    dirtyPrice: finalResult.dirtyPrice,
    cleanPrice: finalResult.cleanPrice,
    accruedInterestPer100: finalResult.accruedInterestPer100
  };
}

module.exports = {
  pricePer100FromYield,
  faceValueFromSettlement,
  yieldFromFaceValueAndSettlement,
  getDaysDifference,
  formatDate,
  parseCouponDate
};
