const pool = require('../config/db');

// Get all counterparties from individual, joint, and corporate tables
async function getAll() {
  const sql = `
    SELECT 
      CONCAT('i', id) AS unique_id, 
      id AS original_id,
      short_name COLLATE utf8mb4_unicode_ci AS short_name, 
      long_name COLLATE utf8mb4_unicode_ci AS long_name, 
      'individual' AS type 
    FROM counterparty_master_individual
    UNION ALL
    SELECT 
      CONCAT('j', id) AS unique_id, 
      id AS original_id,
      short_name COLLATE utf8mb4_unicode_ci AS short_name, 
      long_name COLLATE utf8mb4_unicode_ci AS long_name, 
      'joint' AS type 
    FROM counterparty_master_joint
    UNION ALL
    SELECT 
      CONCAT('c', id) AS unique_id, 
      id AS original_id,
      short_name COLLATE utf8mb4_unicode_ci AS short_name, 
      COALESCE(long_name, company_name) COLLATE utf8mb4_unicode_ci AS long_name, 
      'corporate' AS type 
    FROM counterparty_master_corporate
    ORDER BY short_name
  `;
  const [rows] = await pool.query(sql);
  return rows;
}

// Get a single counterparty by id from any of the three tables
async function getById(id) {
  // Extract the original ID and type from the prefixed ID
  let originalId, type;
  if (id.startsWith('i')) {
    originalId = id.substring(1);
    type = 'individual';
  } else if (id.startsWith('j')) {
    originalId = id.substring(1);
    type = 'joint';
  } else if (id.startsWith('c')) {
    originalId = id.substring(1);
    type = 'corporate';
  } else {
    // Fallback for backward compatibility
    originalId = id;
    type = null;
  }

  if (type === 'individual') {
    const [individual] = await pool.query('SELECT id, short_name, long_name, "individual" AS type FROM counterparty_master_individual WHERE id = ?', [originalId]);
    if (individual.length > 0) return individual[0];
  } else if (type === 'joint') {
    const [joint] = await pool.query('SELECT id, short_name, long_name, "joint" AS type FROM counterparty_master_joint WHERE id = ?', [originalId]);
    if (joint.length > 0) return joint[0];
  } else if (type === 'corporate') {
    const [corporate] = await pool.query('SELECT id, short_name, COALESCE(long_name, company_name) AS long_name, "corporate" AS type FROM counterparty_master_corporate WHERE id = ?', [originalId]);
    if (corporate.length > 0) return corporate[0];
  } else {
    // Try all tables for backward compatibility
    const [individual] = await pool.query('SELECT id, short_name, long_name, "individual" AS type FROM counterparty_master_individual WHERE id = ?', [id]);
    if (individual.length > 0) return individual[0];
    const [joint] = await pool.query('SELECT id, short_name, long_name, "joint" AS type FROM counterparty_master_joint WHERE id = ?', [id]);
    if (joint.length > 0) return joint[0];
    const [corporate] = await pool.query('SELECT id, short_name, COALESCE(long_name, company_name) AS long_name, "corporate" AS type FROM counterparty_master_corporate WHERE id = ?', [id]);
    if (corporate.length > 0) return corporate[0];
  }
  
  return null;
}

module.exports = {
  getAll,
  getById
};
