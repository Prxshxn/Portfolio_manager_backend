const db = require('../config/db');
const { generateCuxNumber } = require('../utils/cuxGenerator');

const CounterpartyJoint = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_joint ORDER BY short_name');
    return rows;
  },
  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_joint WHERE id = ?', [id]);
    return rows[0] || null;
  },
  create: async (data) => {
    // Generate CUX number if not provided
    const cuxNumber = data.cux_number || await generateCuxNumber('joint');
    
    const sql = `INSERT INTO counterparty_master_joint (
      title, short_name, long_name, id_type, cux_number, house_number, street_name, province, postal_code, city, country, telephone, email, mobile, custodian_bank, cds_account
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.title,
      data.short_name,
      data.long_name,
      data.id_type,
      cuxNumber,
      data.house_number,
      data.street_name,
      data.province,
      data.postal_code,
      data.city,
      data.country,
      data.telephone,
      data.email,
      data.mobile,
      data.custodian_bank,
      data.cds_account
    ];
    const [result] = await db.query(sql, values);
    return { ...result, cux_number: cuxNumber };
  },
  update: async (id, data) => {
    const sql = `UPDATE counterparty_master_joint SET
      title = ?, short_name = ?, long_name = ?, id_type = ?,
      house_number = ?, street_name = ?, province = ?, postal_code = ?, city = ?,
      country = ?, telephone = ?, email = ?, mobile = ?, custodian_bank = ?, cds_account = ?
      WHERE id = ?`;
    const values = [
      data.title,
      data.short_name,
      data.long_name,
      data.id_type,
      data.house_number,
      data.street_name,
      data.province,
      data.postal_code,
      data.city,
      data.country,
      data.telephone,
      data.email,
      data.mobile,
      data.custodian_bank,
      data.cds_account,
      id
    ];
    await db.query(sql, values);
    return { success: true };
  }
};

module.exports = CounterpartyJoint;
