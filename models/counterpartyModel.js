const pool = require('../config/db');

// Get all counterparties from individual, joint, and corporate tables
async function getAll() {
  const sql = `
    SELECT 
      id, 
      short_name COLLATE utf8mb4_unicode_ci AS short_name, 
      long_name COLLATE utf8mb4_unicode_ci AS long_name, 
      'individual' AS type 
    FROM counterparty_master_individual
    UNION ALL
    SELECT 
      id, 
      short_name COLLATE utf8mb4_unicode_ci AS short_name, 
      long_name COLLATE utf8mb4_unicode_ci AS long_name, 
      'joint' AS type 
    FROM counterparty_master_joint
    UNION ALL
    SELECT 
      id, 
      short_name COLLATE utf8mb4_unicode_ci AS short_name, 
      COALESCE(long_name, company_name) COLLATE utf8mb4_unicode_ci AS company_name, 
      'corporate' AS type 
    FROM counterparty_master_corporate
    ORDER BY short_name
  `;
  const [rows] = await pool.query(sql);
  return rows;
}

// Get a single counterparty by id from any of the three tables
async function getById(id) {
  const [individual] = await pool.query('SELECT id, short_name, long_name, "individual" AS type FROM counterparty_master_individual WHERE id = ?', [id]);
  if (individual.length > 0) return individual[0];
  const [joint] = await pool.query('SELECT id, short_name, long_name, "joint" AS type FROM counterparty_master_joint WHERE id = ?', [id]);
  if (joint.length > 0) return joint[0];
  const [corporate] = await pool.query('SELECT id, short_name, COALESCE(long_name, company_name) AS long_name, "corporate" AS type FROM counterparty_master_corporate WHERE id = ?', [id]);
  if (corporate.length > 0) return corporate[0];
  return null;
}

module.exports = {
  getAll,
  getById
};
