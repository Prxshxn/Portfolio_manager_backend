const db = require('../config/db');
const { generateCuxNumber } = require('../utils/cuxGenerator');

/** When joint member rows were never persisted, rebuild display slots from combined names. */
function synthesizeMembersFromJointNames(joint) {
  const split = (value) =>
    String(value || '')
      .split(/\s*&\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  const longs = split(joint.long_name);
  const shorts = split(joint.short_name);
  const count = Math.max(longs.length, shorts.length);
  if (count < 1) return [];
  const emptyAddress = {
    houseNumber: '',
    streetName: '',
    province: '',
    postalCode: '',
    city: '',
    country: '',
    telephone: '',
    email: '',
    mobile: ''
  };
  const members = [];
  for (let i = 0; i < count; i += 1) {
    members.push({
      sequence: i + 1,
      title: i === 0 ? joint.title || '' : '',
      shortName: shorts[i] || '',
      longName: longs[i] || '',
      idType: joint.id_type || 'NIC',
      idNumber: '',
      address: { ...emptyAddress },
      cds_account: '',
      custodian_bank: '',
      _synthesized: true
    });
  }
  return members;
}

const CounterpartyJoint = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_joint ORDER BY short_name');
    return rows;
  },
  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM counterparty_master_joint WHERE id = ?', [id]);
    const joint = rows[0] || null;
    
    if (joint) {
      // Fetch relationships (with error handling)
      try {
        let relationships = await CounterpartyJoint.getRelationships(id);
        // Older joints may have empty relationship rows (save used to fail silently).
        // Fall back to splitting the stored combined short/long names so View/Edit still show parties.
        if (!relationships.length) {
          relationships = synthesizeMembersFromJointNames(joint);
        }
        joint.counterparties = relationships;
      } catch (error) {
        console.error('Error fetching relationships for joint counterparty:', error.message);
        joint.counterparties = synthesizeMembersFromJointNames(joint);
      }
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
    
    try {
      // Live schema has no cds_account / custodian_bank on this table — omit them.
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
    } catch (error) {
      console.error('Error saving relationships:', error.message);
      throw error;
    }
  },
  
  getRelationships: async (jointId) => {
    try {
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
      },
      cds_account: '',
      custodian_bank: ''
    }));
    } catch (error) {
      // If table doesn't exist or other error, return empty array
      console.error('Error fetching relationships:', error.message);
      return [];
    }
  }
};

module.exports = CounterpartyJoint;
