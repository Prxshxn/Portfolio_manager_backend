#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Generate a GSec Product Report (Excel) as at a given date.
 *
 * The exported workbook already includes the "Issue Date" and "Last Coupon Date"
 * columns (last coupon is derived from the ISIN coupon calendar as at the report date).
 *
 * Usage:
 *   node scripts/generate-gsec-report.js [asAtDate] [portfolio] [isin]
 *
 * Examples:
 *   node scripts/generate-gsec-report.js 2026-04-30
 *   node scripts/generate-gsec-report.js 2026-04-30 Sherwood
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const reportService = require('../services/gsecReportService');
const reportExporter = require('../utils/reportExporter');

async function main() {
  const asAtDate = process.argv[2] || '2026-04-30';
  const portfolio = process.argv[3] || undefined;
  const isin = process.argv[4] || undefined;

  console.log(
    `Generating GSec report  asAtDate=${asAtDate}` +
      (portfolio ? ` portfolio=${portfolio}` : '') +
      (isin ? ` isin=${isin}` : '')
  );

  const result = await reportService.getGsecReport({ asAtDate, portfolio, isin });
  const data = result?.data || [];
  const summary = result?.summary || [];

  console.log(`Report returned ${data.length} row(s) across ${summary.length} ISIN(s).`);

  const buffer = await reportExporter.export('excel', data, summary);

  const safeDate = String(asAtDate).replace(/[^0-9-]/g, '');
  const suffix = [portfolio, isin].filter(Boolean).join('_');
  const fileName = `gsec-report-${safeDate}${suffix ? `-${suffix}` : ''}.xlsx`;
  const outPath = path.join(process.cwd(), fileName);
  fs.writeFileSync(outPath, Buffer.from(buffer));

  console.log(`\nSaved: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (typeof db.end === 'function') {
      try {
        await db.end();
      } catch (_) {
        /* ignore pool teardown errors */
      }
    }
  });
