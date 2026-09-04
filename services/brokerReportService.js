const db = require('../config/database');

const counterpartyJoinSql = (col) => `
  LEFT JOIN counterparty_master_corporate corp ON (${col} LIKE 'c%' AND CAST(SUBSTRING(${col}, 2) AS UNSIGNED) = corp.id) OR (${col} = corp.id)
  LEFT JOIN counterparty_master_individual ind ON (${col} LIKE 'i%' AND CAST(SUBSTRING(${col}, 2) AS UNSIGNED) = ind.id) OR (${col} = ind.id)
  LEFT JOIN counterparty_master_joint joint ON (${col} LIKE 'j%' AND CAST(SUBSTRING(${col}, 2) AS UNSIGNED) = joint.id) OR (${col} = joint.id)
`;

const counterpartyNameSql = `COALESCE(corp.short_name, ind.short_name, joint.short_name, '')`;

// GSEC + T-Bill deals that have a broker assigned, with brokerage amount.
// gsec.broker stores the broker_code/name directly; tbill.broker_id is a
// numeric FK into brokers.id - both are resolved against the `brokers` table.
exports.getBrokerReport = async ({ startDate, endDate, broker }) => {
  const params = [];
  const gsecWhere = ["g.broker IS NOT NULL", "g.broker <> ''", "g.broker <> '0'"];
  const tbillWhere = ['t.broker_id IS NOT NULL'];

  if (startDate) {
    gsecWhere.push('DATE(g.value_date) >= DATE(?)');
    tbillWhere.push('DATE(t.value_date) >= DATE(?)');
    params.push(startDate, startDate);
  }
  if (endDate) {
    gsecWhere.push('DATE(g.value_date) <= DATE(?)');
    tbillWhere.push('DATE(t.value_date) <= DATE(?)');
    params.push(endDate, endDate);
  }

  const gsecSql = `
    SELECT
      'GSEC' AS product_type,
      g.deal_number AS ref_deal_no,
      ${counterpartyNameSql} AS counterparty,
      g.face_value AS face_value,
      g.brokerage AS brokerage,
      COALESCE(b.broker_name, g.broker) AS broker_name,
      g.broker AS broker_key
    FROM gsec g
    ${counterpartyJoinSql('g.counterparty_id')}
    LEFT JOIN brokers b ON (b.broker_code = g.broker OR CAST(b.id AS CHAR) = g.broker)
    WHERE ${gsecWhere.join(' AND ')}
  `;

  const tbillSql = `
    SELECT
      'T-BILL' AS product_type,
      t.deal_number AS ref_deal_no,
      ${counterpartyNameSql} AS counterparty,
      t.face_value AS face_value,
      t.brokerage AS brokerage,
      b.broker_name AS broker_name,
      CAST(t.broker_id AS CHAR) AS broker_key
    FROM tbill t
    ${counterpartyJoinSql('t.counterparty')}
    LEFT JOIN brokers b ON b.id = t.broker_id
    WHERE ${tbillWhere.join(' AND ')}
  `;

  const gsecParams = [];
  const tbillParams = [];
  if (startDate) { gsecParams.push(startDate); tbillParams.push(startDate); }
  if (endDate) { gsecParams.push(endDate); tbillParams.push(endDate); }

  const [gsecRows] = await db.query(gsecSql, gsecParams);
  const [tbillRows] = await db.query(tbillSql, tbillParams);

  let rows = [...gsecRows, ...tbillRows];
  if (broker) {
    const needle = String(broker).trim().toLowerCase();
    rows = rows.filter((r) => String(r.broker_name || '').toLowerCase().includes(needle));
  }

  rows.sort((a, b) => (a.broker_name || '').localeCompare(b.broker_name || ''));

  const totalBrokerage = rows.reduce((sum, r) => sum + (Number(r.brokerage) || 0), 0);
  const totalFaceValue = rows.reduce((sum, r) => sum + (Number(r.face_value) || 0), 0);

  return {
    data: rows.map((r) => ({
      broker_name: r.broker_name || 'Unassigned',
      ref_deal_no: r.ref_deal_no,
      counterparty: r.counterparty,
      face_value: r.face_value,
      brokerage: r.brokerage,
      product_type: r.product_type
    })),
    total: rows.length,
    totalBrokerage,
    totalFaceValue
  };
};
