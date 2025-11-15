const pool = require('../config/db');

// Helper function to format date
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (e) {
    return dateStr;
  }
}

exports.getCounterpartyReport = async ({ counterparty, nicNumber, name, page, pageSize }) => {
  console.log(`[Counterparty Report] Called with counterparty: ${counterparty}, nicNumber: ${nicNumber}, name: ${name}`);
  
  try {
    // Build WHERE conditions for each table
    let individualWhere = [];
    let jointWhere = [];
    let corporateWhere = [];
    let individualParams = [];
    let jointParams = [];
    let corporateParams = [];
    
    if (counterparty) {
      // Extract type and id from unique_id (e.g., 'i1', 'j1', 'c1')
      const type = counterparty.charAt(0);
      const id = counterparty.substring(1);
      
      if (type === 'i') {
        individualWhere.push('id = ?');
        individualParams.push(id);
      } else if (type === 'j') {
        jointWhere.push('id = ?');
        jointParams.push(id);
      } else if (type === 'c') {
        corporateWhere.push('id = ?');
        corporateParams.push(id);
      }
    }
    
    if (nicNumber) {
      individualWhere.push('id_number LIKE ?');
      individualParams.push(`%${nicNumber}%`);
    }
    
    if (name) {
      individualWhere.push('(long_name LIKE ? OR short_name LIKE ?)');
      individualParams.push(`%${name}%`, `%${name}%`);
      jointWhere.push('(long_name LIKE ? OR short_name LIKE ?)');
      jointParams.push(`%${name}%`, `%${name}%`);
      corporateWhere.push('(long_name LIKE ? OR company_name LIKE ? OR short_name LIKE ?)');
      corporateParams.push(`%${name}%`, `%${name}%`, `%${name}%`);
    }
    
    const individualWhereClause = individualWhere.length > 0 ? 'WHERE ' + individualWhere.join(' AND ') : '';
    const jointWhereClause = jointWhere.length > 0 ? 'WHERE ' + jointWhere.join(' AND ') : '';
    const corporateWhereClause = corporateWhere.length > 0 ? 'WHERE ' + corporateWhere.join(' AND ') : '';
    
    // Build the main query - union all three counterparty types
    const baseQuery = `
      SELECT 
        CONCAT('i', id) AS unique_id,
        'individual' AS cp_type,
        id AS cp_id,
        short_name,
        long_name,
        NULL AS company_name,
        id_number AS nic_number,
        cux_number,
        title,
        id_type,
        house_number,
        street_name,
        city,
        province,
        postal_code,
        country,
        telephone,
        email,
        mobile,
        custodian_bank,
        cds_account
      FROM counterparty_master_individual
      ${individualWhereClause}
      UNION ALL
      SELECT 
        CONCAT('j', id) AS unique_id,
        'joint' AS cp_type,
        id AS cp_id,
        short_name,
        long_name,
        NULL AS company_name,
        NULL AS nic_number,
        cux_number,
        NULL AS title,
        NULL AS id_type,
        NULL AS house_number,
        NULL AS street_name,
        NULL AS city,
        NULL AS province,
        NULL AS postal_code,
        NULL AS country,
        NULL AS telephone,
        NULL AS email,
        NULL AS mobile,
        custodian_bank,
        cds_account
      FROM counterparty_master_joint
      ${jointWhereClause}
      UNION ALL
      SELECT 
        CONCAT('c', id) AS unique_id,
        'corporate' AS cp_type,
        id AS cp_id,
        short_name,
        long_name,
        company_name,
        NULL AS nic_number,
        cux_number,
        NULL AS title,
        NULL AS id_type,
        NULL AS house_number,
        NULL AS street_name,
        city,
        state AS province,
        postal_code,
        country,
        phone_number AS telephone,
        email,
        NULL AS mobile,
        custodian_bank,
        cds_account
      FROM counterparty_master_corporate
      ${corporateWhereClause}
    `;
    
    // Combine all params for count query
    const allParams = [...individualParams, ...jointParams, ...corporateParams];
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) AS all_counterparties`;
    const [countResult] = await pool.query(countQuery, allParams);
    const total = countResult[0]?.total || 0;
    
    // Apply pagination if provided
    let dataQuery = baseQuery;
    let finalParams = allParams;
    if (page && pageSize) {
      const offset = (page - 1) * pageSize;
      dataQuery = `${baseQuery} ORDER BY short_name LIMIT ? OFFSET ?`;
      finalParams = [...allParams, parseInt(pageSize), offset];
    } else {
      dataQuery = `${baseQuery} ORDER BY short_name`;
    }
    
    const [rows] = await pool.query(dataQuery, finalParams);
    
    // Format the results
    const formattedResults = rows.map(row => ({
      unique_id: row.unique_id,
      cux_number: row.cux_number || '',
      short_name: row.short_name || '',
      long_name: row.long_name || '',
      company_name: row.company_name || '',
      name: row.long_name || row.company_name || row.short_name,
      type: row.cp_type || '',
      nic_number: row.nic_number || '',
      title: row.title || '',
      id_type: row.id_type || '',
      address: [
        row.house_number,
        row.street_name,
        row.city,
        row.province,
        row.postal_code,
        row.country
      ].filter(Boolean).join(', '),
      telephone: row.telephone || '',
      email: row.email || '',
      mobile: row.mobile || '',
      custodian_bank: row.custodian_bank || '',
      cds_account: row.cds_account || ''
    }));
    
    console.log(`[Counterparty Report] Returning ${formattedResults.length} results out of ${total} total`);
    
    return {
      data: formattedResults,
      total: total
    };
  } catch (error) {
    console.error('[Counterparty Report] Error:', error);
    throw error;
  }
};

