#!/usr/bin/env node
'use strict';

/**
 * Execute premature maturity for BB20260518002 (Buy/Sell) — deal update only, no ledger.
 * Usage: node scripts/execute-premature-bb20260518002.js [--execute]
 */

const db = require('../config/database');
const MaturityController = require('../controllers/maturityController');

const EXECUTE = process.argv.includes('--execute');
const DEAL_ID = 89;
const PAYLOAD = {
  deals: [{
    dealId: DEAL_ID,
    leg1InterestRate: 11.5,
    leg2ValueDate: '2026-05-29',
    dayCountBasis: 364
  }]
};

function mockRes() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      console.log(JSON.stringify(body, null, 2));
      return body;
    }
  };
}

async function main() {
  const [before] = await db.query(
    `SELECT deal_number, leg2_value_date, leg2_settlement_amount, leg2_clean_price, leg2_dirty_price,
            leg1_interest_rate
       FROM buyback_deals WHERE id = ?`,
    [DEAL_ID]
  );
  if (!before.length) throw new Error('Deal not found');
  console.log('BEFORE:', before[0]);

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  const res = mockRes();
  await MaturityController.processBuybackPrematureMaturity(
    { body: PAYLOAD, user: { id: 1 } },
    res
  );

  if (res.statusCode >= 400) process.exit(1);

  const [after] = await db.query(
    `SELECT deal_number, leg2_value_date, leg2_settlement_amount, leg2_clean_price, leg2_dirty_price,
            leg1_interest_rate
       FROM buyback_deals WHERE id = ?`,
    [DEAL_ID]
  );
  console.log('\nAFTER:', after[0]);

  const [leg2Le] = await db.query(
    'SELECT COUNT(*) AS c FROM ledger_entries WHERE deal_number = ?',
    [`${after[0].deal_number}/BB-L2/SELL`]
  );
  console.log('Leg2 sell ledger lines (should remain 0):', leg2Le[0].c);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
