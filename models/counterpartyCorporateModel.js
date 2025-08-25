const db = require('../config/db');

const CounterpartyCorporate = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_corporate');
    return rows;
  },
  create: async (data) => {
    const sql = `INSERT INTO counterparty_master_corporate (
      company_name, short_name, long_name, registration_number, tin_number, vat_number,
      address_line1, address_line2, city, state, country, postal_code, phone_number, 
      email, website, kyc_status, risk_category, sanctions_check, credit_limit,
      primary_bank_name, bank_account_number, swift_bic_code, treasury_contact_person,
      treasury_contact_email, treasury_contact_phone, custodian_bank, cds_account
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
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
      data.primary_bank_name,
      data.bank_account_number,
      data.swift_bic_code,
      data.treasury_contact_person,
      data.treasury_contact_email,
      data.treasury_contact_phone,
      data.custodian_bank,
      data.cds_account
    ];
    const [result] = await db.query(sql, values);
    return result;
  }
};

module.exports = CounterpartyCorporate;
