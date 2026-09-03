const db = require('../config/db');

const IsinMaster = {
  /**
   * Create a new ISIN. Do not pass id - the table uses AUTO_INCREMENT for unique ids.
   * Supports callback or Promise: create(data, callback) or await create(data).
   */
  create: async (data, callback) => {
    const { id, ...insertData } = data;
    const sql = `INSERT INTO isin_master (isin_issuer, isin_number, issue_date, maturity_date, coupon_rate, series, coupon_date_1, coupon_date_2, day_basis, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      insertData.isin_issuer,
      insertData.isin_number,
      insertData.issue_date,
      insertData.maturity_date,
      insertData.coupon_rate,
      insertData.series,
      insertData.coupon_date_1,
      insertData.coupon_date_2,
      insertData.day_basis,
      insertData.currency
    ];
    try {
      const [result] = await db.query(sql, values);
      if (typeof callback === 'function') callback(null, result);
      return result;
    } catch (err) {
      if (typeof callback === 'function') return callback(err, null);
      throw err;
    }
  },
  getAll: async () => {
    const [results] = await db.query('SELECT * FROM isin_master ORDER BY isin_number ASC');
    return results;
  },
  searchByIsin: async (query) => {
    const sql = 'SELECT isin_number FROM isin_master WHERE isin_number LIKE ? ORDER BY isin_number ASC LIMIT 10';
    const [results] = await db.query(sql, [`%${query}%`]);
    return results;
  },
  getById: async (id) => {
    const [results] = await db.query('SELECT * FROM isin_master WHERE id = ?', [id]);
    return results[0];
  },

  getByIsinNumber: async (isin_number) => {
    const [results] = await db.query('SELECT * FROM isin_master WHERE isin_number = ?', [isin_number]);
    return results[0];
  },

  update: async (id, data) => {
    const sql = `UPDATE isin_master SET 
      isin_issuer = ?, 
      isin_number = ?, 
      issue_date = ?, 
      maturity_date = ?, 
      coupon_rate = ?, 
      series = ?, 
      coupon_date_1 = ?, 
      coupon_date_2 = ?, 
      day_basis = ?, 
      currency = ? 
      WHERE id = ?`;
    const [result] = await db.query(sql, [
      data.isin_issuer,
      data.isin_number,
      data.issue_date,
      data.maturity_date,
      data.coupon_rate,
      data.series,
      data.coupon_date_1,
      data.coupon_date_2,
      data.day_basis,
      data.currency,
      id
    ]);
    return result;
  },

};

module.exports = IsinMaster;
