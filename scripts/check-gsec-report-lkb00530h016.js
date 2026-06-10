#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/** READ-ONLY: run the real GSEC report for LKB00530H016 / Sherwood and show remaining per deal. */

const db = require('../config/database');
const reportService = require('../services/gsecReportService');

async function main() {
  const asAtDate = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log(`Running GSEC report asAtDate=${asAtDate} portfolio=Sherwood isin=LKB00530H016\n`);

  const result = await reportService.getGsecReport({
    asAtDate,
    portfolio: 'Sherwood',
    isin: 'LKB00530H016',
    page: 1,
    pageSize: 500
  });

  const rows = result?.data || result?.rows || result?.deals || [];
  console.log(`Report returned ${Array.isArray(rows) ? rows.length : 'unknown'} row(s).`);
  if (Array.isArray(rows)) {
    rows.forEach((r) => {
      console.log(
        `  deal=${r.deal_number || r.dealNumber} face_col=${r.face_value} ` +
          `eff_remaining=${r.effective_remaining_face} report_remaining=${r.remaining_face_value_report} ` +
          `buyback_against=${r._direct_buyback_against_deal} sold_against=${r._direct_sold_against_deal}`
      );
    });
  } else {
    console.log(JSON.stringify(result, null, 2).slice(0, 2000));
  }

  if (typeof db.end === 'function') await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
