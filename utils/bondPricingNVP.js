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

  // Generate full coupon schedule
  const schedule = generateFullCouponSchedule(issueDate, maturityDate, couponDate1, couponDate2);
  
  if (schedule.length < 2) {
    return { nvp: '', accruedInterest: '' };
  }

  // Find last and next coupon dates
  let lastCouponDate = null;
  let nextCouponDate = null;
  
  for (let i = 0; i < schedule.length; i++) {
    if (schedule[i] <= settle) {
      lastCouponDate = schedule[i];
    }
    if (schedule[i] > settle) {
      nextCouponDate = schedule[i];
      break;
    }
  }

  if (!lastCouponDate || !nextCouponDate) {
    return { nvp: '', accruedInterest: '' };
  }

  // Calculate accrued interest
  const daysSinceLastCoupon = getDaysDifference(settle, lastCouponDate);
  const daysInCouponPeriod = getDaysDifference(nextCouponDate, lastCouponDate);
  
  if (daysInCouponPeriod === 0) {
    return { nvp: '', accruedInterest: '' };
  }

  const couponPayment = (Number(faceValue) * Number(couponRate) / 100) / frequency;

  // Calculate dirty price using the same logic as main form
  const yieldPerPeriod = Number(yieldRate) / 100 / frequency;
  
  // Generate cash flows (same as main form)
  const cashFlows = [];
  for (let i = 0; i < schedule.length; i++) {
    const couponDate = schedule[i];
    if (couponDate > settle) {
      if (couponDate.getTime() === maturity.getTime()) {
        // Maturity payment (face value + final coupon)
        cashFlows.push({
          date: couponDate,
          amount: Number(faceValue) + couponPayment,
          periodCount: i
        });
      } else {
        // Regular coupon payment
        cashFlows.push({
          date: couponDate,
          amount: couponPayment,
          periodCount: i
        });
      }
    }
  }
  
  // Calculate fractional period (same as main form)
  const nextCoupon = schedule.find(d => d > settle);
  const lastCoupon = schedule.find(d => d <= settle);
  const fractionalPeriod = nextCoupon && lastCoupon ? 
    getDaysDifference(settle, lastCoupon) / getDaysDifference(nextCoupon, lastCoupon) : 0;
  
  // Calculate present value of each cash flow (same as main form)
  let dirtyPrice = 0;
  for (const cf of cashFlows) {
    const t = fractionalPeriod + cf.periodCount;
    const pv = cf.amount / Math.pow(1 + yieldPerPeriod, t);
    dirtyPrice += pv;
  }

  // Convert dirty price to per 100 basis
  const dirtyPricePer100 = (dirtyPrice / Number(faceValue)) * 100;
  const truncatedDirtyPrice = Math.floor(dirtyPricePer100 * 10000) / 10000;

  // Calculate accrued interest per 100 (same logic as main form)
  // First calculate coupon payment per 100 face value
  const couponPer100 = (Number(couponRate) / 100) / frequency * 100; // Per 100 basis
  const accruedInterestPer100 = (couponPer100 * daysSinceLastCoupon) / daysInCouponPeriod;
  const truncatedAccruedInterestPer100 = Math.floor(accruedInterestPer100 * 10000) / 10000;

  // Clean price is dirty price minus accrued interest (same logic as main form)
  const cleanPrice = truncatedDirtyPrice - truncatedAccruedInterestPer100;
  const truncatedCleanPrice = Math.floor(cleanPrice * 10000) / 10000;

  // Debug logging
  console.log('NVP Calculation Debug:');
  console.log('System Date (Value Date):', systemDate);
  console.log('Face Value:', faceValue);
  console.log('Coupon Rate:', couponRate);
  console.log('Yield Rate:', yieldRate);
  console.log('Maturity Date:', maturityDate);
  console.log('Last Coupon Date:', lastCouponDate);
  console.log('Next Coupon Date:', nextCouponDate);
  console.log('Days Since Last Coupon:', daysSinceLastCoupon);
  console.log('Days In Coupon Period:', daysInCouponPeriod);
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
