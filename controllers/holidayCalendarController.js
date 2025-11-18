const holidayCalendarService = require('../services/holidayCalendarService');

/**
 * GET /api/holiday-calendar
 * Get all holidays
 */
exports.getAllHolidays = async (req, res) => {
  try {
    const holidays = await holidayCalendarService.getAllHolidays();
    res.json({
      success: true,
      data: holidays
    });
  } catch (error) {
    console.error('Error fetching holidays:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch holidays'
    });
  }
};

/**
 * GET /api/holiday-calendar/:id
 * Get holiday by ID
 */
exports.getHolidayById = async (req, res) => {
  try {
    const { id } = req.params;
    const holiday = await holidayCalendarService.getHolidayById(id);
    res.json({
      success: true,
      data: holiday
    });
  } catch (error) {
    console.error('Error fetching holiday:', error);
    res.status(error.message === 'Holiday not found' ? 404 : 500).json({
      success: false,
      error: error.message || 'Failed to fetch holiday'
    });
  }
};

/**
 * GET /api/holiday-calendar/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Get holidays by date range
 */
exports.getHolidaysByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start date and end date are required'
      });
    }
    
    const holidays = await holidayCalendarService.getHolidaysByDateRange(startDate, endDate);
    res.json({
      success: true,
      data: holidays
    });
  } catch (error) {
    console.error('Error fetching holidays by date range:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch holidays'
    });
  }
};

/**
 * GET /api/holiday-calendar/check/:date
 * Check if a date is a holiday
 */
exports.checkHoliday = async (req, res) => {
  try {
    const { date } = req.params;
    const holiday = await holidayCalendarService.isHoliday(date);
    res.json({
      success: true,
      isHoliday: !!holiday,
      data: holiday
    });
  } catch (error) {
    console.error('Error checking holiday:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check holiday'
    });
  }
};

/**
 * POST /api/holiday-calendar
 * Create a new holiday
 */
exports.createHoliday = async (req, res) => {
  try {
    const { holiday_date, reason } = req.body;
    
    if (!holiday_date || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Holiday date and reason are required'
      });
    }
    
    const holiday = await holidayCalendarService.createHoliday({
      holiday_date,
      reason
    });
    
    res.status(201).json({
      success: true,
      data: holiday,
      message: 'Holiday created successfully'
    });
  } catch (error) {
    console.error('Error creating holiday:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create holiday'
    });
  }
};

/**
 * PUT /api/holiday-calendar/:id
 * Update a holiday
 */
exports.updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const { holiday_date, reason } = req.body;
    
    if (!holiday_date || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Holiday date and reason are required'
      });
    }
    
    const holiday = await holidayCalendarService.updateHoliday(id, {
      holiday_date,
      reason
    });
    
    res.json({
      success: true,
      data: holiday,
      message: 'Holiday updated successfully'
    });
  } catch (error) {
    console.error('Error updating holiday:', error);
    const statusCode = error.message === 'Holiday not found' ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to update holiday'
    });
  }
};

/**
 * DELETE /api/holiday-calendar/:id
 * Delete a holiday
 */
exports.deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    await holidayCalendarService.deleteHoliday(id);
    
    res.json({
      success: true,
      message: 'Holiday deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting holiday:', error);
    const statusCode = error.message === 'Holiday not found' ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to delete holiday'
    });
  }
};

