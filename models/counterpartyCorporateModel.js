const db = require('../config/db');
const { generateCuxNumber } = require('../utils/cuxGenerator');

const CounterpartyCorporate = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_corporate ORDER BY short_name');
    return rows;
  },
  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_corporate WHERE id = ?', [id]);
    return rows[0] || null;
  },
  create: async (data) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateModel.js:13',message:'create entry',data:{hasCuxNumber:!!data.cux_number,dataKeys:Object.keys(data),creditLimit:data.credit_limit,creditLimitType:typeof data.credit_limit},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C,D'})}).catch(()=>{});
    // #endregion
    // Generate CUX number if not provided
    let cuxNumber;
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateModel.js:16',message:'before generateCuxNumber',data:{hasCuxInData:!!data.cux_number},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      cuxNumber = data.cux_number || await generateCuxNumber('corporate');
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateModel.js:19',message:'after generateCuxNumber',data:{cuxNumber:cuxNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    } catch (cuxErr) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateModel.js:22',message:'generateCuxNumber error',data:{error:cuxErr.message,stack:cuxErr.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      throw cuxErr;
    }
    
    const sql = `INSERT INTO counterparty_master_corporate (
      company_name, short_name, long_name, registration_number, tin_number, vat_number,
      address_line1, address_line2, city, state, country, postal_code, phone_number, 
      email, website, kyc_status, risk_category, sanctions_check, credit_limit,
      primary_bank_name, bank_account_number, swift_bic_code, treasury_contact_person,
      treasury_contact_email, treasury_contact_phone, custodian_bank, cds_account, cux_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    // Validate required fields
    if (!data.company_name || data.company_name.trim() === '') {
      throw new Error('Company name is required');
    }
    
    // Handle credit_limit: convert empty string to null, or parse to number
    let creditLimit = data.credit_limit;
    if (creditLimit === '' || creditLimit === undefined || creditLimit === null) {
      creditLimit = null;
    } else {
      creditLimit = parseFloat(creditLimit) || null;
    }
    
    const values = [
      data.company_name,
      data.short_name || null,
      data.long_name || null,
      data.registration_number || null,
      data.tin_number || null,
      data.vat_number || null,
      data.address_line1 || null,
      data.address_line2 || null,
      data.city || null,
      data.state || null,
      data.country || null,
      data.postal_code || null,
      data.phone_number || null,
      data.email || null,
      data.website || null,
      data.kyc_status || 'Pending',
      data.risk_category || 'Low',
      data.sanctions_check || 'Passed',
      creditLimit,
      data.primary_bank_name || null,
      data.bank_account_number || null,
      data.swift_bic_code || null,
      data.treasury_contact_person || null,
      data.treasury_contact_email || null,
      data.treasury_contact_phone || null,
      data.custodian_bank || null,
      data.cds_account || null,
      cuxNumber
    ];
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateModel.js:54',message:'before db.query',data:{valuesCount:values.length,placeholdersCount:(sql.match(/\?/g)||[]).length,values:values.map((v,i)=>`val${i}:${v===null?'NULL':v===undefined?'UNDEF':typeof v}:${String(v).substring(0,50)}`)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,C,D,E'})}).catch(()=>{});
    // #endregion
    try {
      const [result] = await db.query(sql, values);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateModel.js:57',message:'after db.query success',data:{insertId:result.insertId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,C,D,E'})}).catch(()=>{});
      // #endregion
      return { ...result, cux_number: cuxNumber };
    } catch (dbErr) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateModel.js:60',message:'db.query error',data:{error:dbErr.message,code:dbErr.code,errno:dbErr.errno,sqlState:dbErr.sqlState,sqlMessage:dbErr.sqlMessage,sql:dbErr.sql},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,C,D,E'})}).catch(()=>{});
      // #endregion
      throw dbErr;
    }
  },
  update: async (id, data) => {
    const sql = `UPDATE counterparty_master_corporate SET
      company_name = ?, short_name = ?, long_name = ?, registration_number = ?, tin_number = ?, vat_number = ?,
      address_line1 = ?, address_line2 = ?, city = ?, state = ?, country = ?, postal_code = ?, phone_number = ?,
      email = ?, website = ?, kyc_status = ?, risk_category = ?, sanctions_check = ?, credit_limit = ?,
      primary_bank_name = ?, bank_account_number = ?, swift_bic_code = ?, treasury_contact_person = ?,
      treasury_contact_email = ?, treasury_contact_phone = ?, custodian_bank = ?, cds_account = ?
      WHERE id = ?`;
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
      data.cds_account,
      id
    ];
    await db.query(sql, values);
    return { success: true };
  }
};

module.exports = CounterpartyCorporate;
