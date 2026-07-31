#!/usr/bin/env node
'use strict';
const db = require('../config/database');
(async () => {
  const [rows] = await db.query(
    "SELECT * FROM gsec WHERE deal_number = '20260619/GSEC/0002' AND transaction_type = 'Buy' LIMIT 1"
  );
  const b = rows[0];
  if (!b) { console.log('not found'); process.exit(1); }
  const keys = Object.keys(b).filter((k) =>
    /isin|coupon|maturity|accrued|clean|dirty|yield|face|security/i.test(k)
  );
  for (const k of keys.sort()) console.log(k, ':', b[k]);

  // peer buys same maturity
  const [peers] = await db.query(
    `SELECT deal_number, accrued_interest_calculation, coupon_interest, yield, clean_price, dirty_price
     FROM gsec WHERE maturity_date = ? AND transaction_type = 'Buy'
       AND accrued_interest_calculation IS NOT NULL
       AND CAST(accrued_interest_calculation AS DECIMAL(20,6)) < 100
     ORDER BY value_date DESC LIMIT 5`,
    [b.maturity_date]
  );
  console.log('\nPeer buys same maturity:');
  console.log(JSON.stringify(peers, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
