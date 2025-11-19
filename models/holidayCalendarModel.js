const db = require('../config/db');

/**
 * Get all holidays
 * @returns {Promise<Array>} Array of holiday objects
 */
async function getAllHolidays() {
  const [rows] = await db.query(
    'SELECT * FROM holiday_calendar ORDER BY holiday_date ASC'
  );
  return rows;
}

/**
 * Get holiday by ID
 * @param {number} id - Holiday ID
 * @returns {Promise<Object>} Holiday object
 */
async function getHolidayById(id) {
  const [rows] = await db.query(
    'SELECT * FROM holiday_calendar WHERE id = ?',
    [id]
  );
  return rows[0];
}

/**
 * Get holidays by date range
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of holiday objects
 */
async function getHolidaysByDateRange(startDate, endDate) {
  const [rows] = await db.query(
    'SELECT * FROM holiday_calendar WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date ASC',
    [startDate, endDate]
  );
  return rows;
}

/**
 * Check if a date is a holiday
 * @param {string} date - Date to check (YYYY-MM-DD)
 * @returns {Promise<Object|null>} Holiday object if found, null otherwise
 */
async function isHoliday(date) {
  const [rows] = await db.query(
    'SELECT * FROM holiday_calendar WHERE holiday_date = ?',
    [date]
  );
  return rows[0] || null;
}

/**
 * Create a new holiday
 * @param {Object} holiday - Holiday object with holiday_date, reason, and optional fund_centre_id
 * @returns {Promise<number>} Insert ID
 */
async function createHoliday(holiday) {
  const { holiday_date, reason, fund_centre_id } = holiday;
  const [result] = await db.query(
    'INSERT INTO holiday_calendar (holiday_date, reason, fund_centre_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [holiday_date, reason, fund_centre_id || null]
  );
  return result.insertId;
}

/**
 * Update a holiday
 * @param {number} id - Holiday ID
 * @param {Object} holiday - Holiday object with holiday_date, reason, and optional fund_centre_id
 * @returns {Promise<boolean>} Success status
 */
async function updateHoliday(id, holiday) {
  const { holiday_date, reason, fund_centre_id } = holiday;
  const [result] = await db.query(
    'UPDATE holiday_calendar SET holiday_date = ?, reason = ?, fund_centre_id = ?, updated_at = NOW() WHERE id = ?',
    [holiday_date, reason, fund_centre_id || null, id]
  );
  return result.affectedRows > 0;
}

/**
 * Delete a holiday
 * @param {number} id - Holiday ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteHoliday(id) {
  const [result] = await db.query(
    'DELETE FROM holiday_calendar WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

module.exports = {
  getAllHolidays,
  getHolidayById,
  getHolidaysByDateRange,
  isHoliday,
  createHoliday,
  updateHoliday,
  deleteHoliday
};

