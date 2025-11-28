const db = require('../config/db');
const { generateCuxNumber } = require('../utils/cuxGenerator');

const CounterpartyJoint = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_joint ORDER BY short_name');
    return rows;
  },
  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_joint WHERE id = ?', [id]);
    const joint = rows[0] || null;
    
    if (joint) {
      // Fetch relationships
      const relationships = await CounterpartyJoint.getRelationships(id);
      joint.counterparties = relationships;
    }
    
    return joint;
  },
  create: async (data) => {
    // Generate CUX number if not provided
    const cuxNumber = data.cux_number || await generateCuxNumber('joint');
    
    const sql = `INSERT INTO counterparty_master_joint (
      title, short_name, long_name, id_type, cux_number, house_number, street_name, province, postal_code, city, country, telephone, email, mobile, custodian_bank, cds_account
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.title,
      data.short_name,
      data.long_name,
      data.id_type,
      cuxNumber,
      data.house_number,
      data.street_name,
      data.province,
      data.postal_code,
      data.city,
      data.country,
      data.telephone,
      data.email,
      data.mobile,
      data.custodian_bank,
      data.cds_account
    ];
    const [result] = await db.query(sql, values);
    const jointId = result.insertId;
    
    // Save counterparty relationships if provided
    if (data.counterparties && Array.isArray(data.counterparties) && data.counterparties.length > 0) {
      await CounterpartyJoint.saveRelationships(jointId, data.counterparties);
    }
    
    return { ...result, cux_number: cuxNumber, insertId: jointId };
  },
  update: async (id, data) => {
    const sql = `UPDATE counterparty_master_joint SET
      title = ?, short_name = ?, long_name = ?, id_type = ?,
      house_number = ?, street_name = ?, province = ?, postal_code = ?, city = ?,
      country = ?, telephone = ?, email = ?, mobile = ?, custodian_bank = ?, cds_account = ?
      WHERE id = ?`;
    const values = [
      data.title,
      data.short_name,
      data.long_name,
      data.id_type,
      data.house_number,
      data.street_name,
      data.province,
      data.postal_code,
      data.city,
      data.country,
      data.telephone,
      data.email,
      data.mobile,
      data.custodian_bank,
      data.cds_account,
      id
    ];
    await db.query(sql, values);
    
    // Update relationships if provided
    if (data.counterparties && Array.isArray(data.counterparties)) {
      // Delete existing relationships
      await db.query('DELETE FROM joint_counterparty_relationships WHERE joint_counterparty_id = ?', [id]);
      // Insert new relationships
      if (data.counterparties.length > 0) {
        await CounterpartyJoint.saveRelationships(id, data.counterparties);
      }
    }
    
    return { success: true };
  },
  
  saveRelationships: async (jointId, counterparties) => {
    if (!counterparties || counterparties.length === 0) return;
    
    const sql = `INSERT INTO joint_counterparty_relationships 
      (joint_counterparty_id, sequence_number, title, short_name, long_name, id_type, id_number,
       house_number, street_name, province, postal_code, city, country, telephone, email, mobile) 
      VALUES ?`;
    
    const values = counterparties.map((cp, index) => [
      jointId,
      index + 1,
      cp.title || '',
      cp.short_name || '',
      cp.long_name || '',
      cp.id_type || '',
      cp.id_number || '',
      cp.address?.houseNumber || cp.address?.house_number || '',
      cp.address?.streetName || cp.address?.street_name || '',
      cp.address?.province || '',
      cp.address?.postalCode || cp.address?.postal_code || '',
      cp.address?.city || '',
      cp.address?.country || '',
      cp.address?.telephone || '',
      cp.address?.email || '',
      cp.address?.mobile || ''
    ]);
    
    await db.query(sql, [values]);
  },
  
  getRelationships: async (jointId) => {
    const [rows] = await db.query(
      `SELECT sequence_number, title, short_name, long_name, id_type, id_number,
              house_number, street_name, province, postal_code, city, country, 
              telephone, email, mobile
       FROM joint_counterparty_relationships 
       WHERE joint_counterparty_id = ? 
       ORDER BY sequence_number`,
      [jointId]
    );
    return rows.map(row => ({
      sequence: row.sequence_number,
      title: row.title,
      shortName: row.short_name,
      longName: row.long_name,
      idType: row.id_type,
      idNumber: row.id_number,
      address: {
        houseNumber: row.house_number,
        streetName: row.street_name,
        province: row.province,
        postalCode: row.postal_code,
        city: row.city,
        country: row.country,
        telephone: row.telephone,
        email: row.email,
        mobile: row.mobile
      }
    }));
  }
};

module.exports = CounterpartyJoint;
