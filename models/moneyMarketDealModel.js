const pool = require('../db');

// Get all deals
async function getAllDeals() {
  const [rows] = await pool.query('SELECT * FROM `money_market_deals`');
  return rows;
}

// Get maturities by date (without deal status filtering as requested)
async function getMaturitiesByDate(date) {
  const query = `
    SELECT 
      mmd.deal_number,
      mmd.counterparty_id,
      COALESCE(
        corp.short_name,
        ind.short_name,
        joint.short_name,
        mmd.counterparty_id
      ) as counterparty_name,
      mmd.principal_amount,
      mmd.maturity_date,
      mmd.deal_status,
      DATEDIFF(mmd.maturity_date, CURDATE()) as days_to_maturity
    FROM money_market_deals mmd
    LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
    LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
    LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
    WHERE mmd.maturity_date <= ?
    ORDER BY mmd.maturity_date ASC
  `;
  
  const [rows] = await pool.query(query, [date]);
  return rows;
}

module.exports = { getAllDeals, getMaturitiesByDate };
