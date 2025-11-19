const holidayCalendarModel = require('../models/holidayCalendarModel');

/**
 * Get all holidays
 */
exports.getAllHolidays = async () => {
  try {
    return await holidayCalendarModel.getAllHolidays();
  } catch (error) {
    console.error('Error fetching holidays:', error);
    throw error;
  }
};

/**
 * Get holiday by ID
 */
exports.getHolidayById = async (id) => {
  try {
    const holiday = await holidayCalendarModel.getHolidayById(id);
    if (!holiday) {
      throw new Error('Holiday not found');
    }
    return holiday;
  } catch (error) {
    console.error('Error fetching holiday:', error);
    throw error;
  }
};

/**
 * Get holidays by date range
 */
exports.getHolidaysByDateRange = async (startDate, endDate) => {
  try {
    return await holidayCalendarModel.getHolidaysByDateRange(startDate, endDate);
  } catch (error) {
    console.error('Error fetching holidays by date range:', error);
    throw error;
  }
};

/**
 * Check if a date is a holiday
 */
exports.isHoliday = async (date) => {
  try {
    return await holidayCalendarModel.isHoliday(date);
  } catch (error) {
    console.error('Error checking holiday:', error);
    throw error;
  }
};

/**
 * Create a new holiday
 */
exports.createHoliday = async (holidayData) => {
  try {
    const { holiday_date, reason } = holidayData;
    
    if (!holiday_date) {
      throw new Error('Holiday date is required');
    }
    
    if (!reason || reason.trim() === '') {
      throw new Error('Reason is required');
    }
    
    // Check if holiday already exists for this date
    const existing = await holidayCalendarModel.isHoliday(holiday_date);
    if (existing) {
      throw new Error('A holiday already exists for this date');
    }
    
    const id = await holidayCalendarModel.createHoliday({
      holiday_date,
      reason: reason.trim(),
      fund_centre_id: holidayData.fund_centre_id || null
    });
    
    return await holidayCalendarModel.getHolidayById(id);
  } catch (error) {
    console.error('Error creating holiday:', error);
    throw error;
  }
};

/**
 * Update a holiday
 */
exports.updateHoliday = async (id, holidayData) => {
  try {
    const { holiday_date, reason } = holidayData;
    
    if (!holiday_date) {
      throw new Error('Holiday date is required');
    }
    
    if (!reason || reason.trim() === '') {
      throw new Error('Reason is required');
    }
    
    // Check if holiday exists
    const existing = await holidayCalendarModel.getHolidayById(id);
    if (!existing) {
      throw new Error('Holiday not found');
    }
    
    // Check if another holiday exists for this date (excluding current)
    const dateHoliday = await holidayCalendarModel.isHoliday(holiday_date);
    if (dateHoliday && dateHoliday.id !== id) {
      throw new Error('A holiday already exists for this date');
    }
    
    const success = await holidayCalendarModel.updateHoliday(id, {
      holiday_date,
      reason: reason.trim(),
      fund_centre_id: holidayData.fund_centre_id || null
    });
    
    if (!success) {
      throw new Error('Failed to update holiday');
    }
    
    return await holidayCalendarModel.getHolidayById(id);
  } catch (error) {
    console.error('Error updating holiday:', error);
    throw error;
  }
};

/**
 * Delete a holiday
 */
exports.deleteHoliday = async (id) => {
  try {
    const existing = await holidayCalendarModel.getHolidayById(id);
    if (!existing) {
      throw new Error('Holiday not found');
    }
    
    const success = await holidayCalendarModel.deleteHoliday(id);
    if (!success) {
      throw new Error('Failed to delete holiday');
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting holiday:', error);
    throw error;
  }
};

