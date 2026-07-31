#!/usr/bin/env node
'use strict';
const db = require('../config/database');

function ymd(d) {
  if (!d) return '-';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return String(d).slice(0, 10);
  return x.toISOString().slice(0, 10);
}

(async () => {
  const [rows] = await db.query(`
    SELECT mpl.deal_number,
           mpl.processed_date,
           mpl.principal_amount,
           mpl.interest_amount,
           mpl.total_amount,
           mpl.notes,
           bd.leg1_transaction_type,
           bd.leg2_transaction_type,
           DATE(bd.leg1_value_date) AS leg1_vd,
           DATE(bd.leg2_value_date) AS leg2_vd,
           COALESCE(bd.leg1_adjusted_face_value, bd.leg1_face_value) AS bb_face_value,
           g.face_value AS gsec_face_value
    FROM maturity_processing_log mpl
    LEFT JOIN buyback_deals bd
      ON bd.deal_number COLLATE utf8mb4_unicode_ci = mpl.deal_number COLLATE utf8mb4_unicode_ci
    LEFT JOIN gsec g
      ON g.deal_number COLLATE utf8mb4_unicode_ci = mpl.deal_number COLLATE utf8mb4_unicode_ci
    WHERE mpl.maturity_action = 'premature_maturity'
    ORDER BY mpl.processed_date DESC, mpl.id DESC
  `);

  const fmt = (n) =>
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  console.log(`Premature deals processed: ${rows.length}\n`);
  const W = {
    deal: 22,
    face: 20,
    proc: 12,
    type: 14,
    leg2: 12,
    principal: 18,
    interest: 14,
    total: 18
  };
  const sep = ' | ';
  console.log(
    'Deal Number'.padEnd(W.deal) + sep +
      'Face Value'.padStart(W.face) + sep +
      'Processed'.padEnd(W.proc) + sep +
      'Type'.padEnd(W.type) + sep +
      'Leg2 VD'.padEnd(W.leg2) + sep +
      'Principal'.padStart(W.principal) + sep +
      'Interest'.padStart(W.interest) + sep +
      'Total'.padStart(W.total)
  );
  console.log('-'.repeat(130));

  for (const r of rows) {
    let type = 'Other';
    if (String(r.deal_number).startsWith('BB')) {
      type =
        r.leg1_transaction_type === 'Buy' && r.leg2_transaction_type === 'Sell'
          ? 'Buy/Sell'
          : r.leg1_transaction_type === 'Sell' && r.leg2_transaction_type === 'Buy'
            ? 'Sell/Buy'
            : 'Buyback';
    } else if (String(r.deal_number).includes('GSEC')) type = 'GSec';
    else if (String(r.deal_number).startsWith('REPO')) type = 'Repo';

    const face = r.bb_face_value != null ? r.bb_face_value : r.gsec_face_value;

    console.log(
      String(r.deal_number).padEnd(W.deal) + sep +
        fmt(face).padStart(W.face) + sep +
        ymd(r.processed_date).padEnd(W.proc) + sep +
        type.padEnd(W.type) + sep +
        ymd(r.leg2_vd).padEnd(W.leg2) + sep +
        fmt(r.principal_amount).padStart(W.principal) + sep +
        fmt(r.interest_amount).padStart(W.interest) + sep +
        fmt(r.total_amount).padStart(W.total)
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
