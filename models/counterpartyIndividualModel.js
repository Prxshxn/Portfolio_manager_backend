const db = require('../config/db');
const { generateCuxNumber } = require('../utils/cuxGenerator');

const CounterpartyIndividual = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_individual ORDER BY short_name');
    return rows;
  },
  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_individual WHERE id = ?', [id]);
    return rows[0] || null;
  },
  checkNicExists: async (nicNumber, excludeId = null) => {
    if (!nicNumber) return false;
    let sql = 'SELECT id FROM counterparty_master_individual WHERE id_number = ?';
    const params = [nicNumber];
    if (excludeId) {
      sql += ' AND id != ?';
      params.push(excludeId);
    }
    const [rows] = await db.query(sql, params);
    return rows.length > 0;
  },
  create: async (data) => {
    // Check if NIC number already exists
    if (data.id_number) {
      const nicExists = await CounterpartyIndividual.checkNicExists(data.id_number);
      if (nicExists) {
        throw new Error('NIC number already exists. Please use a different NIC number.');
      }
    }
    
    // Generate CUX number if not provided
    const cuxNumber = data.cux_number || await generateCuxNumber('individual');
    
    const sql = `INSERT INTO counterparty_master_individual (
      title, short_name, long_name, id_type, id_number, cux_number, house_number, street_name, province, postal_code, city, country, telephone, email, mobile, custodian_bank, cds_account
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.title,
      data.short_name,
      data.long_name,
      data.id_type,
      data.id_number || null,
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
    // Check if NIC number already exists (excluding current record)
    if (data.id_number) {
      const nicExists = await CounterpartyIndividual.checkNicExists(data.id_number, id);
      if (nicExists) {
        throw new Error('NIC number already exists. Please use a different NIC number.');
      }
    }
    
    const sql = `UPDATE counterparty_master_individual SET
      title = ?, short_name = ?, long_name = ?, id_type = ?, id_number = ?,
      house_number = ?, street_name = ?, province = ?, postal_code = ?, city = ?,
      country = ?, telephone = ?, email = ?, mobile = ?, custodian_bank = ?, cds_account = ?
      WHERE id = ?`;
    const values = [
      data.title,
      data.short_name,
      data.long_name,
      data.id_type,
      data.id_number || null,
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

module.exports = CounterpartyIndividual;
