const db = require('../config/db');

const IssuerMaster = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM issuer_master ORDER BY company_name');
    return rows;
  },
  
  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM issuer_master WHERE id = ? OR issuer_id = ?', [id, id]);
    return rows[0] || null;
  },
  
  create: async (data) => {
    const sql = `INSERT INTO issuer_master (
      issuer_id, company_name, short_name, long_name, registration_number, tin_number, vat_number,
      address_line1, address_line2, city, state, country, postal_code, phone_number, 
      email, website, kyc_status, risk_category, sanctions_check, credit_limit,
      bank_name, bank_branch, contact_person
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const values = [
      data.issuer_id,
      data.company_name,
      data.short_name,
      data.long_name,
      data.registration_number,
      data.tin_number,
      data.vat_number,
      data.address_line1,
      data.address_line2,
      data.city,
      data.state,
      data.country,
      data.postal_code,
      data.phone_number,
      data.email,
      data.website,
      data.kyc_status || 'Pending',
      data.risk_category || 'Low',
      data.sanctions_check || 'Passed',
      data.credit_limit || 0.00,
      data.bank_name,
      data.bank_branch,
      data.contact_person
    ];
    
    const [result] = await db.query(sql, values);
    return { id: result.insertId, ...data };
  },
  
  update: async (id, data) => {
    const sql = `UPDATE issuer_master SET
      company_name = ?, short_name = ?, long_name = ?, registration_number = ?, tin_number = ?, vat_number = ?,
      address_line1 = ?, address_line2 = ?, city = ?, state = ?, country = ?, postal_code = ?, phone_number = ?,
      email = ?, website = ?, kyc_status = ?, risk_category = ?, sanctions_check = ?, credit_limit = ?,
      bank_name = ?, bank_branch = ?, contact_person = ?
      WHERE id = ? OR issuer_id = ?`;
    
    const values = [
      data.company_name,
      data.short_name,
      data.long_name,
      data.registration_number,
      data.tin_number,
      data.vat_number,
      data.address_line1,
      data.address_line2,
      data.city,
      data.state,
      data.country,
      data.postal_code,
      data.phone_number,
      data.email,
      data.website,
      data.kyc_status,
      data.risk_category,
      data.sanctions_check,
      data.credit_limit,
      data.bank_name,
      data.bank_branch,
      data.contact_person,
      id,
      id
    ];
    
    await db.query(sql, values);
    return { success: true };
  },
  
  delete: async (id) => {
    await db.query('DELETE FROM issuer_master WHERE id = ? OR issuer_id = ?', [id, id]);
    return { success: true };
  }
};

module.exports = IssuerMaster;
