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
    // Validate required fields
    if (!data.company_name || data.company_name.trim() === '') {
      throw new Error('Company name is required');
    }
    
    // Convert empty strings to null for optional fields
    const cleanValue = (val) => {
      if (val === '' || val === null || val === undefined) return null;
      return String(val).trim() || null;
    };
    
    // Handle credit_limit - convert empty string to 0, or parse if it's a string
    let creditLimit = 0.00;
    if (data.credit_limit !== '' && data.credit_limit !== null && data.credit_limit !== undefined) {
      const parsed = parseFloat(data.credit_limit);
      creditLimit = isNaN(parsed) ? 0.00 : parsed;
    }
    
    // Try to use numeric id first, fallback to issuer_id if id is not numeric
    const numericId = parseInt(id);
    const isNumericId = !isNaN(numericId) && String(numericId) === String(id);
    
    const sql = `UPDATE issuer_master SET
      company_name = ?, short_name = ?, long_name = ?, registration_number = ?, tin_number = ?, vat_number = ?,
      address_line1 = ?, address_line2 = ?, city = ?, state = ?, country = ?, postal_code = ?, phone_number = ?,
      email = ?, website = ?, kyc_status = ?, risk_category = ?, sanctions_check = ?, credit_limit = ?,
      bank_name = ?, bank_branch = ?, contact_person = ?
      WHERE ${isNumericId ? 'id = ?' : 'issuer_id = ?'}`;
    
    const values = [
      data.company_name.trim(),
      cleanValue(data.short_name),
      cleanValue(data.long_name),
      cleanValue(data.registration_number),
      cleanValue(data.tin_number),
      cleanValue(data.vat_number),
      cleanValue(data.address_line1),
      cleanValue(data.address_line2),
      cleanValue(data.city),
      cleanValue(data.state),
      cleanValue(data.country),
      cleanValue(data.postal_code),
      cleanValue(data.phone_number),
      cleanValue(data.email),
      cleanValue(data.website),
      data.kyc_status || 'Pending',
      data.risk_category || 'Low',
      data.sanctions_check || 'Passed',
      creditLimit,
      cleanValue(data.bank_name),
      cleanValue(data.bank_branch),
      cleanValue(data.contact_person),
      isNumericId ? numericId : id
    ];
    
    console.log('Update SQL:', sql);
    console.log('Update values:', values);
    console.log('Update ID:', id, 'Is numeric:', isNumericId);
    
    const [result] = await db.query(sql, values);
    
    if (result.affectedRows === 0) {
      throw new Error('No issuer found with the provided ID');
    }
    
    return { success: true, affectedRows: result.affectedRows };
  },
  
  delete: async (id) => {
    await db.query('DELETE FROM issuer_master WHERE id = ? OR issuer_id = ?', [id, id]);
    return { success: true };
  }
};

module.exports = IssuerMaster;
