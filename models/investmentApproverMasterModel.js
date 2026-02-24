const db = require('../config/db');

const InvestmentApproverMaster = {
  getAll: async () => {
    const [rows] = await db.query(
      'SELECT * FROM investment_approver_master ORDER BY name'
    );
    return rows;
  },

  getById: async (id) => {
    const [rows] = await db.query(
      'SELECT * FROM investment_approver_master WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  create: async (data) => {
    const sql = `
      INSERT INTO investment_approver_master (
        name,
        approver_type,
        designation,
        contact_number,
        address,
        approver_level,
        approver_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.name,
      data.approver_type || 'Individual',
      data.designation || null,
      data.contact_number || null,
      data.address || null,
      data.approver_level || 'Checker',
      data.approver_limit || 0.0
    ];

    const [result] = await db.query(sql, values);
    return { id: result.insertId, ...data };
  },

  update: async (id, data) => {
    const sql = `
      UPDATE investment_approver_master SET
        name = ?,
        approver_type = ?,
        designation = ?,
        contact_number = ?,
        address = ?,
        approver_level = ?,
        approver_limit = ?
      WHERE id = ?
    `;

    const values = [
      data.name,
      data.approver_type,
      data.designation,
      data.contact_number,
      data.address,
      data.approver_level,
      data.approver_limit,
      id
    ];

    await db.query(sql, values);
    return { success: true };
  },

  delete: async (id) => {
    await db.query(
      'DELETE FROM investment_approver_master WHERE id = ?',
      [id]
    );
    return { success: true };
  }
};

module.exports = InvestmentApproverMaster;

