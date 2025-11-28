const express = require('express');
const router = express.Router();
const holidayCalendarController = require('../controllers/holidayCalendarController');
const { checkAuth } = require('../middleware/auth');

// All routes require authentication
router.use(checkAuth);

// GET /api/holiday-calendar - Get all holidays
router.get('/', holidayCalendarController.getAllHolidays);

// GET /api/holiday-calendar/range - Get holidays by date range
router.get('/range', holidayCalendarController.getHolidaysByDateRange);

// GET /api/holiday-calendar/check/:date - Check if a date is a holiday
router.get('/check/:date', holidayCalendarController.checkHoliday);

// GET /api/holiday-calendar/check-currency/:date?currency=LKR - Check if a date is a holiday for a currency (includes weekends)
router.get('/check-currency/:date', holidayCalendarController.checkHolidayForCurrency);

// GET /api/holiday-calendar/:id - Get holiday by ID
router.get('/:id', holidayCalendarController.getHolidayById);

// POST /api/holiday-calendar - Create a new holiday
router.post('/', holidayCalendarController.createHoliday);

// PUT /api/holiday-calendar/:id - Update a holiday
router.put('/:id', holidayCalendarController.updateHoliday);

// DELETE /api/holiday-calendar/:id - Delete a holiday
router.delete('/:id', holidayCalendarController.deleteHoliday);

module.exports = router;

