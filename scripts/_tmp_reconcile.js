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
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  const d = new Date(t);
  if (!isNaN(d)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

(async () => {
  const csvPath = path.resolve(__dirname, '../../16.04.2026.csv');
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = parseCsvLine(line);
    const isin = (parts[0] || '').trim();
    if (!/^LKB\w+/.test(isin)) continue;
    const valueDate = parseDate(parts[2]);
    const maturityDate = parseDate(parts[3]);
    const faceValue = parseMoney(parts[7]);
    const couponInterest = parseMoney(parts[13]);
    const couponPeriodDays = parseMoney(parts[15]);
    const perDayAccrual = parseMoney(parts[17]);
    rows.push({ isin, valueDate, maturityDate, faceValue, couponInterest, couponPeriodDays, perDayAccrual });
  }

  console.log('CSV rows parsed:', rows.length);
  const totals = rows.reduce((a, r) => ({ fv: a.fv + r.faceValue, ci: a.ci + r.couponInterest, pd: a.pd + r.perDayAccrual }), { fv: 0, ci: 0, pd: 0 });
  console.log('CSV totals:', {
    outstandingFace: totals.fv.toFixed(2),
    couponInterest: totals.ci.toFixed(2),
    perDayAccrual: totals.pd.toFixed(2),
  });

  // Match each CSV row to a gsec deal: same ISIN and same value_date (since face_value is the remaining balance in CSV).
  const asAt = '2026-04-16';
  let totalExpected = 0;
  let totalComputed = 0;
  const mismatches = [];
  const unmatched = [];
  for (const r of rows) {
    if (!r.isin || !r.valueDate) { unmatched.push({ reason: 'missing isin/valueDate', ...r }); continue; }
    const [res] = await db.query(
      `SELECT g.id, g.deal_number, g.face_value, g.remaining_face_value, g.coupon_interest, g.number_of_days_for_coupon_period, g.per_day_accrual, g.value_date, g.maturity_date, g.isin_number, im.coupon_date_1, im.coupon_date_2, im.coupon_rate
       FROM gsec g LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
       WHERE g.transaction_type='Buy' AND g.status='final_approved' AND g.isin_number=? AND DATE(g.value_date)=DATE(?)`,
      [r.isin, r.valueDate]
    );
    // Prefer deal whose remaining_face_value matches the CSV balance
    let deal = res.find(d => Math.abs(Number(d.remaining_face_value || 0) - r.faceValue) < 1);
    if (!deal) deal = res.find(d => Math.abs(Number(d.face_value || 0) - r.faceValue) < 1);
    if (!deal && res.length === 1) deal = res[0];
    if (!deal) { unmatched.push({ reason: 'no deal match', ...r, candidates: res.length }); continue; }
    const computed = computeGsecPerDayAccrual(deal, asAt, 2);
    const computedAmt = computed.ok ? Number(computed.amount || 0) : 0;
    totalExpected += r.perDayAccrual;
    totalComputed += computedAmt;
    const diff = Math.round((r.perDayAccrual - computedAmt) * 100) / 100;
    if (Math.abs(diff) >= 0.01) {
      mismatches.push({
        isin: r.isin, value_date: r.valueDate, deal_number: deal.deal_number,
        expected_per_day: r.perDayAccrual,
        computed_per_day: Math.round(computedAmt * 100) / 100,
        diff,
        csv_face_value: r.faceValue,
        db_face_value: Number(deal.face_value || 0),
        db_remaining: Number(deal.remaining_face_value || 0),
        db_coupon_interest: Number(deal.coupon_interest || 0),
        csv_coupon_interest: r.couponInterest,
        computed_reason: computed.ok ? null : computed.reason,
      });
    }
  }

  console.log('\n--- Reconciliation Summary ---');
  console.log('CSV per-day total    :', totals.pd.toFixed(2));
  console.log('DB computed total    :', totalComputed.toFixed(2));
  console.log('Difference (CSV - DB):', (totals.pd - totalComputed).toFixed(2));
  console.log('\nUnmatched CSV rows:', unmatched.length);
  unmatched.forEach(u => console.log('  -', u));
  console.log('\nMismatches (top 50 by abs diff):');
  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  mismatches.slice(0, 50).forEach(m => console.log('  ', JSON.stringify(m)));
  const totalDiff = mismatches.reduce((s, m) => s + m.diff, 0);
  console.log('\nSum of per-row diffs:', totalDiff.toFixed(2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
