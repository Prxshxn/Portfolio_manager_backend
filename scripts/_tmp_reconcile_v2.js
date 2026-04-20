const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

function parseMoney(s) {
  if (s === null || s === undefined) return 0;
  const t = String(s).replace(/"/g, '').replace(/,/g, '').trim();
  if (!t || t === '-' || t === '00.00') return 0;
  const n = Number(t);
  return isNaN(n) ? 0 : n;
}
function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}

(async () => {
  const csvPath = path.resolve(__dirname, '../../gsec_report (59).csv');
  const text = fs.readFileSync(csvPath, 'utf8');
  const reportRows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = parseCsvLine(line);
    const deal = (p[3] || '').trim();
    if (!/^\d{8}\/GSEC\/\d{4}$/.test(deal)) continue;
    const faceValue = parseMoney(p[4]);
    const isin = (p[7] || '').trim();
    const reportFace = parseMoney(p[16]); // "Balance" column - aggregate per ISIN
    const perDayAccrual = parseMoney(p[25]);
    reportRows.push({ deal, isin, faceValue, perDayAccrual });
  }

  const reportTotal = reportRows.reduce((s, r) => s + r.perDayAccrual, 0);
  console.log('Report rows parsed :', reportRows.length);
  console.log('Report per-day sum :', reportTotal.toFixed(4));

  const iso = '2026-04-17';
  const matches = [];
  const missing = [];
  let eodTotal = 0;
  for (const r of reportRows) {
    const [dbRows] = await db.query(
      `SELECT g.id, g.deal_number, g.isin_number, g.face_value, g.remaining_face_value, g.coupon_interest, g.value_date, g.maturity_date,
              im.coupon_date_1, im.coupon_date_2, im.coupon_rate
       FROM gsec g LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
       WHERE g.deal_number=? AND g.status='final_approved' AND g.transaction_type='Buy'`,
      [r.deal]
    );
    if (!dbRows.length) { missing.push({ deal: r.deal, isin: r.isin, face: r.faceValue, reason: 'deal not found in DB' }); continue; }
    const d = dbRows[0];
    const c = computeGsecPerDayAccrual(d, iso, 2);
    const eodAmt = c.ok ? Number(c.amount || 0) : 0;
    eodTotal += eodAmt;
    const diff = Math.round((r.perDayAccrual - eodAmt) * 100) / 100;
    if (Math.abs(diff) >= 0.01) {
      matches.push({
        deal: r.deal, isin: r.isin, report_face: r.faceValue,
        db_face: Number(d.face_value), db_rfv: Number(d.remaining_face_value),
        report_per_day: r.perDayAccrual, eod_per_day: Math.round(eodAmt * 100) / 100,
        diff, reason: c.ok ? 'value mismatch' : c.reason,
      });
    }
  }

  console.log('\n===== Summary =====');
  console.log('REPORT per-day total         :', reportTotal.toFixed(2));
  console.log('EOD per-day (for report deals):', eodTotal.toFixed(2));
  console.log('Difference (REPORT - EOD)    :', (reportTotal - eodTotal).toFixed(2));

  console.log('\n===== Missing deals in DB =====');
  missing.forEach(m => console.log(' ', m));

  console.log('\n===== Mismatches (report expects but EOD differs/skips) =====');
  matches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  matches.forEach(m => console.log(' ', m));
  const sumDiff = matches.reduce((s, m) => s + m.diff, 0);
  console.log('\nSum of mismatches diff:', sumDiff.toFixed(2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
