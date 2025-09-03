const db = require('../config/db');

const RepoDeal = {
  // Create a new repo deal
  create: async (dealData) => {
    try {
             const sql = `
         INSERT INTO repo_deals (
           deal_type, counterparty_id, trade_date, value_date, maturity_date,
           principal_amount, interest_amount, rate, maturity_amount, tenor,
           calculation_day_basis, isin_number, issue_date, haircut, face_value,
           face_value_adjustment, face_value_as_per_counterparty,
           status, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       `;
       
       const values = [
         dealData.dealType,
         dealData.counterparty,
         dealData.tradeDate,
        dealData.valueDate,
        dealData.maturityDate,
        dealData.principalAmount,
        dealData.interestAmount,
        dealData.rate,
        dealData.maturityAmount,
        dealData.tenor,
        dealData.calculationDayBasis,
        dealData.isin,
        dealData.issueDate,
        dealData.haircut || 0,
        dealData.faceValue || null,
        dealData.faceValueAdjustment || 0,
        dealData.faceValueAsPerCounterparty || null,
        dealData.status || 'Pending',
        dealData.createdBy
      ];

      const [result] = await db.query(sql, values);
      return { id: result.insertId, ...dealData };
    } catch (error) {
      console.error('Error creating repo deal:', error);
      throw error;
    }
  },

  // Get all repo deals with optional filters
  getAll: async (filters = {}) => {
    try {
             let sql = `
         SELECT 
           rd.*,
           COALESCE(
             corp.short_name, 
             ind.short_name, 
             joint.short_name
           ) as counterparty_name,
           COALESCE(
             corp.long_name, 
             ind.long_name, 
             joint.long_name
           ) as counterparty_long_name,
           u.username as created_by_name
         FROM repo_deals rd
         LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
         LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
         LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
         LEFT JOIN users u ON rd.created_by = u.id
         WHERE 1=1
       `;
      
      const values = [];
      
      if (filters.dealType) {
        sql += ' AND rd.deal_type = ?';
        values.push(filters.dealType);
      }
      
      if (filters.status) {
        sql += ' AND rd.status = ?';
        values.push(filters.status);
      }
      
      if (filters.counterpartyId) {
        sql += ' AND rd.counterparty_id = ?';
        values.push(filters.counterpartyId);
      }
      
      if (filters.startDate) {
        sql += ' AND rd.trade_date >= ?';
        values.push(filters.startDate);
      }
      
      if (filters.endDate) {
        sql += ' AND rd.trade_date <= ?';
        values.push(filters.endDate);
      }
      
      sql += ' ORDER BY rd.created_at DESC';
      
      const [results] = await db.query(sql, values);
      return results;
    } catch (error) {
      console.error('Error fetching repo deals:', error);
      throw error;
    }
  },

  // Get repo deal by ID
  getById: async (id) => {
    try {
             const sql = `
         SELECT 
           rd.*,
           COALESCE(
             corp.short_name, 
             ind.short_name, 
             joint.short_name
           ) as counterparty_name,
           COALESCE(
             corp.long_name, 
             ind.long_name, 
             joint.long_name
           ) as counterparty_long_name,
           u.username as created_by_name
         FROM repo_deals rd
         LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
         LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
         LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
         LEFT JOIN users u ON rd.created_by = u.id
         WHERE rd.id = ?
       `;
      
      const [results] = await db.query(sql, [id]);
      return results[0] || null;
    } catch (error) {
      console.error('Error fetching repo deal by ID:', error);
      throw error;
    }
  },

  // Update repo deal
  update: async (id, updateData) => {
    try {
             const allowedFields = [
         'deal_type', 'counterparty_id', 'trade_date', 'value_date', 'maturity_date',
         'principal_amount', 'interest_amount', 'rate', 'maturity_amount', 'tenor',
         'calculation_day_basis', 'isin_number', 'issue_date', 'haircut', 'face_value',
         'face_value_adjustment', 'face_value_as_per_counterparty',
         'status'
       ];
      
      const updates = [];
      const values = [];
      
      for (const [key, value] of Object.entries(updateData)) {
        if (allowedFields.includes(key) && value !== undefined) {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
      
      if (updates.length === 0) {
        throw new Error('No valid fields to update');
      }
      
      values.push(id);
      
      const sql = `UPDATE repo_deals SET ${updates.join(', ')} WHERE id = ?`;
      const [result] = await db.query(sql, values);
      
      if (result.affectedRows === 0) {
        throw new Error('Repo deal not found');
      }
      
      return { id, ...updateData };
    } catch (error) {
      console.error('Error updating repo deal:', error);
      throw error;
    }
  },

  // Delete repo deal
  delete: async (id) => {
    try {
      const sql = 'DELETE FROM repo_deals WHERE id = ?';
      const [result] = await db.query(sql, [id]);
      
      if (result.affectedRows === 0) {
        throw new Error('Repo deal not found');
      }
      
      return { id, deleted: true };
    } catch (error) {
      console.error('Error deleting repo deal:', error);
      throw error;
    }
  },

  // Get repo deals by counterparty
  getByCounterparty: async (counterpartyId) => {
    try {
      const sql = `
        SELECT * FROM repo_deals 
        WHERE counterparty_id = ? 
        ORDER BY created_at DESC
      `;
      
      const [results] = await db.query(sql, [counterpartyId]);
      return results;
    } catch (error) {
      console.error('Error fetching repo deals by counterparty:', error);
      throw error;
    }
  },

  // Get repo deals by ISIN
  getByIsin: async (isinNumber) => {
    try {
      const sql = `
        SELECT * FROM repo_deals 
        WHERE isin_number = ? 
        ORDER BY created_at DESC
      `;
      
      const [results] = await db.query(sql, [isinNumber]);
      return results;
    } catch (error) {
      console.error('Error fetching repo deals by ISIN:', error);
      throw error;
    }
  },

  // Get active repo deals
  getActive: async () => {
    try {
      const sql = `
        SELECT * FROM repo_deals 
        WHERE status = 'Active' 
        ORDER BY maturity_date ASC
      `;
      
      const [results] = await db.query(sql);
      return results;
    } catch (error) {
      console.error('Error fetching active repo deals:', error);
      throw error;
    }
  },

  // Get repo deals expiring soon (within specified days)
  getExpiringSoon: async (days = 7) => {
    try {
      const sql = `
        SELECT * FROM repo_deals 
        WHERE status = 'Active' 
        AND maturity_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        ORDER BY maturity_date ASC
      `;
      
      const [results] = await db.query(sql, [days]);
      return results;
    } catch (error) {
      console.error('Error fetching expiring repo deals:', error);
      throw error;
    }
  },

  // Update status of repo deal
  updateStatus: async (id, status) => {
    try {
      const sql = 'UPDATE repo_deals SET status = ? WHERE id = ?';
      const [result] = await db.query(sql, [status, id]);
      
      if (result.affectedRows === 0) {
        throw new Error('Repo deal not found');
      }
      
      return { id, status };
    } catch (error) {
      console.error('Error updating repo deal status:', error);
      throw error;
    }
  },

  // Get summary statistics
  getSummary: async () => {
    try {
      const sql = `
        SELECT 
          COUNT(*) as total_deals,
          COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_deals,
          COUNT(CASE WHEN status = 'Matured' THEN 1 END) as matured_deals,
          COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending_deals,
          SUM(CASE WHEN status = 'Active' THEN principal_amount ELSE 0 END) as total_principal,
          SUM(CASE WHEN status = 'Active' THEN interest_amount ELSE 0 END) as total_interest,
          AVG(CASE WHEN status = 'Active' THEN rate ELSE NULL END) as avg_rate
        FROM repo_deals
      `;
      
      const [results] = await db.query(sql);
      return results[0];
    } catch (error) {
      console.error('Error fetching repo deals summary:', error);
      throw error;
    }
  }
};

module.exports = RepoDeal;
