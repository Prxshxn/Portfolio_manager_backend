const holidayCalendarModel = require('../models/holidayCalendarModel');
const fundCentreMasterModel = require('../models/fundCentreMasterModel');
const db = require('../config/db');

/**
 * Check if a date is a holiday for a given currency
 * @param {string} date - Date to check (YYYY-MM-DD)
 * @param {string} currency - Currency code (defaults to 'LKR')
 * @returns {Promise<Object>} Object with isHoliday flag and holiday details
 */
exports.isHolidayForCurrency = async (date, currency = 'LKR') => {
  try {
    // Format date to YYYY-MM-DD if needed
    let formattedDate = date;
    if (date instanceof Date) {
      formattedDate = date.toISOString().split('T')[0];
    } else if (typeof date === 'string' && date.includes('/')) {
      // Convert DD/MM/YYYY to YYYY-MM-DD
      const parts = date.split('/');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    
    // Check for holidays on this date
    // 1. Check for general holidays (fund_centre_id is NULL - applies to all)
    // 2. Check for currency-specific holidays (fund_centre_id matches the fund centre for this currency)
    const [rows] = await db.query(
      `SELECT h.*, fc.name as fund_centre_name, fc.fund_centre_code, fc.currency
       FROM holiday_calendar h
       LEFT JOIN fund_centre_master fc ON h.fund_centre_id = fc.id
       WHERE h.holiday_date = ?
         AND (h.fund_centre_id IS NULL OR fc.currency = ?)
       ORDER BY h.fund_centre_id IS NULL DESC
       LIMIT 1`,
      [formattedDate, currency]
    );
    
    if (rows.length > 0) {
      const holiday = rows[0];
      return {
        isHoliday: true,
        holiday: {
          id: holiday.id,
          date: holiday.holiday_date,
          reason: holiday.reason,
          fundCentreName: holiday.fund_centre_name || 'All Fund Centres',
          fundCentreCode: holiday.fund_centre_code || 'N/A',
          currency: holiday.currency || currency
        }
      };
    }
    
    return { isHoliday: false, holiday: null };
  } catch (error) {
    console.error('Error checking holiday for currency:', error);
    // On error, don't block transactions - log and return false
    return { isHoliday: false, holiday: null };
  }
};

/**
 * Validate if transaction dates are holidays
 * @param {Object} transactionData - Transaction data with dates and currency
 * @returns {Promise<Object>} Validation result with isHoliday flag and message
 */
exports.validateTransactionDates = async (transactionData) => {
  try {
    const { tradeDate, valueDate, currency = 'LKR' } = transactionData;
    
    // Check both trade date and value date
    const datesToCheck = [];
    if (tradeDate) datesToCheck.push({ date: tradeDate, type: 'Trade Date' });
    if (valueDate) datesToCheck.push({ date: valueDate, type: 'Value Date' });
    
    // Remove duplicates
    const uniqueDates = [...new Map(datesToCheck.map(item => [item.date, item])).values()];
    
    for (const { date, type } of uniqueDates) {
      // Format date to YYYY-MM-DD if needed
      let formattedDate = date;
      if (date instanceof Date) {
        formattedDate = date.toISOString().split('T')[0];
      } else if (typeof date === 'string' && date.includes('/')) {
        // Convert DD/MM/YYYY to YYYY-MM-DD
        const parts = date.split('/');
        if (parts.length === 3) {
          formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }
      
      const holidayCheck = await exports.isHolidayForCurrency(formattedDate, currency);
      
      if (holidayCheck.isHoliday) {
        const holiday = holidayCheck.holiday;
        return {
          isValid: false,
          isHoliday: true,
          message: `${type} (${formattedDate}) is a holiday for currency ${currency}. Reason: ${holiday.reason}. Fund Centre: ${holiday.fundCentreName}. Transactions cannot be saved on holidays.`,
          holiday: holiday
        };
      }
    }
    
    return {
      isValid: true,
      isHoliday: false,
      message: 'No holidays found for the transaction dates'
    };
  } catch (error) {
    console.error('Error validating transaction dates:', error);
    // On error, allow transaction (fail open) but log the error
    return {
      isValid: true,
      isHoliday: false,
      message: 'Holiday validation check failed, transaction allowed'
    };
  }
};

