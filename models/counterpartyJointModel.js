const db = require('../config/db');
const { generateCuxNumber } = require('../utils/cuxGenerator');

const CounterpartyJoint = {
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
  }
};

module.exports = CounterpartyJoint;
