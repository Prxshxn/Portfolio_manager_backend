const db = require('../config/db');

const BuybackAuthorizer = {
  // Create a new buyback authorizer assignment
  create: async (authorizerData) => {
    const sql = `INSERT INTO authorizer_assignments 
                 (user_id, transaction_type, role, per_deal_limit, per_day_limit, allowed_pages) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    
    const values = [
      authorizerData.user_id,
      authorizerData.transaction_type,
      authorizerData.role,
      authorizerData.per_deal_limit || 0,
      authorizerData.per_day_limit || 0,
      Array.isArray(authorizerData.allowed_pages) ? 
        authorizerData.allowed_pages.join(',') : 
        authorizerData.allowed_pages || ''
    ];

    const [result] = await db.query(sql, values);
    return result;
  },

  // Get all buyback authorizer assignments
  getAll: async () => {
    const sql = `SELECT 
      aa.*,
      u.username,
      u.email
    FROM authorizer_assignments aa
    JOIN users u ON aa.user_id = u.id
    WHERE aa.transaction_type = 'Buyback'
    ORDER BY aa.created_at DESC`;
    
    const [rows] = await db.query(sql);
    return rows;
  },

  // Get authorizer assignment by user and transaction type
  getByUserAndType: async (userId, transactionType) => {
    const sql = `SELECT 
      aa.*,
      u.username,
      u.email
    FROM authorizer_assignments aa
    JOIN users u ON aa.user_id = u.id
    WHERE aa.user_id = ? AND aa.transaction_type = ?`;
    
    const [rows] = await db.query(sql, [userId, transactionType]);
    return rows[0];
  },

  // Check if user has specific role for buyback
  hasRole: async (userId, role) => {
    const sql = `SELECT id FROM authorizer_assignments 
                 WHERE user_id = ? AND transaction_type = 'Buyback' AND role = ?`;
    
    const [rows] = await db.query(sql, [userId, role]);
    return rows.length > 0;
  },

  // Update authorizer assignment
  update: async (id, authorizerData) => {
    const sql = `UPDATE authorizer_assignments 
                 SET role = ?, per_deal_limit = ?, per_day_limit = ?, allowed_pages = ?
                 WHERE id = ?`;
    
    const values = [
      authorizerData.role,
      authorizerData.per_deal_limit || 0,
      authorizerData.per_day_limit || 0,
      Array.isArray(authorizerData.allowed_pages) ? 
        authorizerData.allowed_pages.join(',') : 
        authorizerData.allowed_pages || '',
      id
    ];

    const [result] = await db.query(sql, values);
    return result;
  },

  // Delete authorizer assignment
  delete: async (id) => {
    const sql = 'DELETE FROM authorizer_assignments WHERE id = ?';
    const [result] = await db.query(sql, [id]);
    return result;
  },

  // Check user's limits for buyback deals
  checkLimits: async (userId, dealAmount) => {
    const sql = `SELECT per_deal_limit, per_day_limit 
                 FROM authorizer_assignments 
                 WHERE user_id = ? AND transaction_type = 'Buyback'`;
    
    const [rows] = await db.query(sql, [userId]);
    if (rows.length === 0) {
      return { allowed: false, reason: 'User not authorized for buyback transactions' };
    }

    const limits = rows[0];
    
    // Check per deal limit
    if (limits.per_deal_limit > 0 && dealAmount > limits.per_deal_limit) {
      return { 
        allowed: false, 
        reason: `Deal amount exceeds per-deal limit of ${limits.per_deal_limit}` 
      };
    }

    // Check daily limit (sum of today's approved deals)
    if (limits.per_day_limit > 0) {
      const dailySql = `SELECT COALESCE(SUM(leg1_settlement_amount + leg2_settlement_amount), 0) as daily_total
                        FROM buyback_deals 
                        WHERE (approved_by = ? OR verified_by = ?) 
                        AND DATE(created_at) = CURDATE()`;
      
      const [dailyRows] = await db.query(dailySql, [userId, userId]);
      const dailyTotal = dailyRows[0].daily_total;
      
      if (dailyTotal + dealAmount > limits.per_day_limit) {
        return { 
          allowed: false, 
          reason: `Daily limit exceeded. Current: ${dailyTotal}, Limit: ${limits.per_day_limit}` 
        };
      }
    }

    return { allowed: true };
  }
};

module.exports = BuybackAuthorizer;
