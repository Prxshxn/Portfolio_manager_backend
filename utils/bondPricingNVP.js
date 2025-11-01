const { differenceInDays, parseISO, addMonths } = require('date-fns');

// Helper to truncate to 4 decimals
function truncate4(val) {
  return Math.floor(Number(val) * 10000) / 10000;
}

// Helper to safely parse ISO date strings
function safeParseISO(val) {
  if (!val) return null;
  if (typeof val === 'string') return parseISO(val);
  if (val instanceof Date) return val;
  return null;
}

// Calculate days difference between two dates
function getDaysDifference(date1, date2) {
  if (!date1 || !date2) return 0;
  const d1 = safeParseISO(date1);
  const d2 = safeParseISO(date2);
  if (!d1 || !d2) return 0;
  return differenceInDays(d1, d2);
}

// Generate full coupon schedule
function generateFullCouponSchedule(issueDate, maturityDate, couponDate1, couponDate2) {
  const schedule = [];
  const issue = safeParseISO(issueDate);
  const maturity = safeParseISO(maturityDate);
  
  if (!issue || !maturity) return schedule;
  
  // Parse coupon dates
  const c1 = safeParseISO(couponDate1);
  const c2 = safeParseISO(couponDate2);
  
  if (!c1 || !c2) return schedule;
  
  // Generate schedule from issue to maturity
  let currentDate = new Date(issue);
  const endDate = new Date(maturity);
  
  // Add issue date
  schedule.push(new Date(issue));
  
  // Generate coupon dates
  while (currentDate < endDate) {
    // Add 6 months for semi-annual coupons
    currentDate = addMonths(currentDate, 6);
    if (currentDate <= endDate) {
      schedule.push(new Date(currentDate));
    }
  }
  
  // Add maturity date
  schedule.push(new Date(maturity));
  
  return schedule;
}

// Calculate clean price using system date as value date
function calculateNVP({
  faceValue,
  couponRate,
  yieldRate,
  systemDate, // This will be the current system date
  maturityDate,
  issueDate,
  couponDate1,
  couponDate2
}) {
  console.log("CALCULATE NVP FUNCTION CALLED");
  
  if (!faceValue || !couponRate || !yieldRate || !systemDate || !maturityDate || !issueDate || !couponDate1 || !couponDate2) {
    return { nvp: '', accruedInterest: '' };
  }

  // Fixed semi-annual frequency
  const frequency = 2;

  // Parse and normalize all date inputs
  const issue = safeParseISO(issueDate);
  const maturity = safeParseISO(maturityDate);
  const settle = safeParseISO(systemDate); // Use system date as value date
  const c1 = safeParseISO(couponDate1);
  const c2 = safeParseISO(couponDate2);

  if (!issue || !maturity || !settle || !c1 || !c2) {
    return { nvp: '', accruedInterest: '' };
  }

  // Find last and next coupon dates (matching frontend logic exactly)
  // Start from issue date and move forward until past settle date, then step back
  let lastCoupon = new Date(issue);
  const monthsPerPeriod = 12 / frequency; // 6 months for semi-annual

  // Move forward until we're past the settle date
  while (lastCoupon <= settle) {
    lastCoupon.setMonth(lastCoupon.getMonth() + monthsPerPeriod);
  }

  // Step back to get the last coupon date before settle date
  lastCoupon.setMonth(lastCoupon.getMonth() - monthsPerPeriod);

  // Create next coupon date by adding one period to last coupon
  const nextCoupon = new Date(lastCoupon);
  nextCoupon.setMonth(nextCoupon.getMonth() + monthsPerPeriod);

  const lastCouponDate = lastCoupon;
  const nextCouponDate = nextCoupon;

  // Calculate days for accrued interest
  const daysSinceLastCoupon = getDaysDifference(settle, lastCouponDate);
  const daysInCouponPeriod = getDaysDifference(nextCouponDate, lastCouponDate);
  
  if (daysInCouponPeriod === 0) {
    return { nvp: '', accruedInterest: '' };
  }

  // Use per-100 basis from the start (matching frontend calculation exactly)
  const fv = 100; // Always use 100 as face value for per-100 calculations
  const cr = Number(couponRate) / 100; // Convert percentage to decimal
  const ytm = Number(yieldRate) / 100; // Convert percentage to decimal
  // monthsPerPeriod already declared above

  // Calculate coupon payment per 100 (matching frontend)
  const coupon = fv * cr / frequency;
  const ytmPerPeriod = ytm / frequency;
  
  // Calculate fractional period (matching frontend logic exactly)
  // Fractional period = days from settle date to next coupon / days in coupon period
  const daysToNextCoupon = getDaysDifference(nextCouponDate, settle);
  const fractionalPeriod = daysToNextCoupon / daysInCouponPeriod;
  
  // Generate cash flows from next coupon to maturity (matching frontend)
  const cashFlows = [];
  let cfDate = new Date(nextCouponDate);
  let periodCount = 0;

  while (cfDate <= maturity) {
    const isFinal = cfDate.getTime() === maturity.getTime();
    const amount = isFinal ? coupon + fv : coupon; // Final includes face value
    cashFlows.push({
      date: new Date(cfDate),
      amount,
      periodCount
    });
    cfDate.setMonth(cfDate.getMonth() + monthsPerPeriod);
    periodCount++;
  }
  
  // Calculate present value of each cash flow (matching frontend)
  let dirtyPrice = 0;
  for (const cf of cashFlows) {
    const t = fractionalPeriod + cf.periodCount;
    const pv = cf.amount / Math.pow(1 + ytmPerPeriod, t);
    dirtyPrice += pv;
  }

  // Truncate dirty price to 4 decimals (matching frontend)
  const dirtyPrice10000 = Math.floor(dirtyPrice * 10000 + 0.0001);
  const truncatedDirtyPrice = dirtyPrice10000 / 10000;

  // Calculate accrued interest per 100 (matching frontend logic)
  const daysAccrued = getDaysDifference(settle, lastCouponDate);
  const accruedInterest = coupon * (daysAccrued / daysInCouponPeriod);
  const truncatedAccruedInterestPer100 = Math.floor(accruedInterest * 10000) / 10000;

  // Clean price is dirty price minus accrued interest (matching frontend)
  const cleanPrice = truncatedDirtyPrice - truncatedAccruedInterestPer100;
  const truncatedCleanPrice = Math.floor(cleanPrice * 10000) / 10000;

  // Debug logging
  console.log('NVP Calculation Debug:');
  console.log('Value Date (systemDate):', systemDate);
  console.log('Face Value (input):', faceValue, '(using fv=100 for calculation)');
  console.log('Coupon Rate:', couponRate);
  console.log('Yield Rate:', yieldRate);
  console.log('Maturity Date:', maturityDate);
  console.log('Last Coupon Date:', lastCouponDate);
  console.log('Next Coupon Date:', nextCouponDate);
  console.log('Days Accrued:', daysAccrued);
  console.log('Days In Coupon Period:', daysInCouponPeriod);
  console.log('Fractional Period:', fractionalPeriod);
  console.log('Number of cash flows:', cashFlows.length);
  console.log('Dirty Price Per 100:', truncatedDirtyPrice);
  console.log('Accrued Interest Per 100:', truncatedAccruedInterestPer100);
  console.log('Clean Price Per 100 (NVP):', truncatedCleanPrice);
  console.log('================================');

  return {
    nvp: truncatedCleanPrice.toFixed(4),
    accruedInterest: truncatedAccruedInterestPer100.toFixed(4)
  };
}

module.exports = {
  calculateNVP,
  truncate4
};
