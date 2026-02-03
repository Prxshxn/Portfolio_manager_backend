const db = require('../config/db');

/**
 * Get all fund centres
 * @returns {Promise<Array>} Array of fund centre objects
 */
async function getAllFundCentres() {
  const [rows] = await db.query(
    'SELECT * FROM itms.fund_centre_master ORDER BY fund_centre_code ASC'
  );
  return rows;
}

/**
 * Get fund centre by ID
 * @param {number} id - Fund centre ID
 * @returns {Promise<Object>} Fund centre object
 */
async function getFundCentreById(id) {
  const [rows] = await db.query(
    'SELECT * FROM itms.fund_centre_master WHERE id = ?',
    [id]
  );
  return rows[0];
}

/**
 * Get fund centre by code
 * @param {string} code - Fund centre code
 * @returns {Promise<Object|null>} Fund centre object if found, null otherwise
 */
async function getFundCentreByCode(code) {
  const [rows] = await db.query(
    'SELECT * FROM itms.fund_centre_master WHERE fund_centre_code = ?',
    [code]
  );
  return rows[0];
}

/**
 * Get fund centre by currency
 * @param {string} currency - Currency code
 * @returns {Promise<Object|null>} Fund centre object if found, null otherwise
 */
async function getFundCentreByCurrency(currency) {
  const [rows] = await db.query(
    'SELECT * FROM itms.fund_centre_master WHERE currency = ?',
    [currency]
  );
  return rows[0];
}

/**
 * Create a new fund centre
 * @param {Object} fundCentre - Fund centre object with name, fund_centre_code, country, gmt_timezone, currency
 * @returns {Promise<number>} ID of the created fund centre
 */
async function createFundCentre(fundCentre) {
  const { 
    name, 
    fund_centre_code, 
    country, 
    gmt_timezone, 
    currency,
    city,
    iana_timezone,
    latitude,
    longitude,
    dst_observed
  } = fundCentre;
  
  const [result] = await db.query(
    `INSERT INTO itms.fund_centre_master 
     (name, fund_centre_code, country, gmt_timezone, currency, city, iana_timezone, latitude, longitude, dst_observed, created_at, updated_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [name, fund_centre_code, country, gmt_timezone, currency, city || null, iana_timezone || null, latitude || null, longitude || null, dst_observed || 'N']
  );
  return result.insertId;
}

/**
 * Update a fund centre
 * @param {number} id - Fund centre ID
 * @param {Object} fundCentre - Fund centre object with name, fund_centre_code, country, gmt_timezone, currency
 * @returns {Promise<boolean>} Success status
 */
async function updateFundCentre(id, fundCentre) {
  const { 
    name, 
    fund_centre_code, 
    country, 
    gmt_timezone, 
    currency,
    city,
    iana_timezone,
    latitude,
    longitude,
    dst_observed
  } = fundCentre;
  
  const [result] = await db.query(
    `UPDATE itms.fund_centre_master 
     SET name = ?, fund_centre_code = ?, country = ?, gmt_timezone = ?, currency = ?, 
         city = ?, iana_timezone = ?, latitude = ?, longitude = ?, dst_observed = ?, 
         updated_at = NOW() 
     WHERE id = ?`,
    [name, fund_centre_code, country, gmt_timezone, currency, city || null, iana_timezone || null, latitude || null, longitude || null, dst_observed || 'N', id]
  );
  return result.affectedRows > 0;
}

/**
 * Delete a fund centre
 * @param {number} id - Fund centre ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteFundCentre(id) {
  const [result] = await db.query(
    'DELETE FROM itms.fund_centre_master WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

module.exports = {
  getAllFundCentres,
  getFundCentreById,
  getFundCentreByCode,
  getFundCentreByCurrency,
  createFundCentre,
  updateFundCentre,
  deleteFundCentre
};
