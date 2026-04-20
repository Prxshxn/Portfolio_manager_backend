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
function parseDate(s) {
  if (!s) return null;
  const d = new Date(String(s).trim());
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

(async () => {
  const csvPath = path.resolve(__dirname, '../../16.04.2026.csv');
  const text = fs.readFileSync(csvPath, 'utf8');
  const csvKey = new Map(); // key: isin|value_date -> { face, perDay }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = parseCsvLine(line);
    const isin = (p[0]||'').trim();
    if (!/^LKB\w+/.test(isin)) continue;
    const vd = parseDate(p[2]);
    if (!vd) continue;
    const key = `${isin}|${vd}`;
    const prev = csvKey.get(key) || { face: 0, perDay: 0, rows: 0 };
    prev.face += parseMoney(p[7]);
    prev.perDay += parseMoney(p[17]);
    prev.rows += 1;
    csvKey.set(key, prev);
  }

  // All Buy/final_approved deals with rfv = 0 (explicit), eligible date range for today
  const iso = '2026-04-17';
  const [skipped] = await db.query(
    `SELECT g.deal_number, g.isin_number, g.face_value, g.remaining_face_value, g.coupon_interest, g.value_date, g.maturity_date,
            im.coupon_date_1, im.coupon_date_2, im.coupon_rate
     FROM gsec g LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.transaction_type='Buy' AND g.status='final_approved'
       AND DATE(g.value_date) <= DATE(?) AND DATE(g.maturity_date) >= DATE(?)
       AND g.remaining_face_value IS NOT NULL AND g.remaining_face_value <= 0
     ORDER BY g.isin_number, g.deal_number`, [iso, iso]);

  let csvHas = [];
  let genuineSold = [];
  for (const d of skipped) {
    const vd = new Date(d.value_date);
    const vdIso = `${vd.getFullYear()}-${String(vd.getMonth()+1).padStart(2,'0')}-${String(vd.getDate()).padStart(2,'0')}`;
    const key = `${d.isin_number}|${vdIso}`;
    if (csvKey.has(key)) {
      // CSV expects this deal to still have balance. Simulate accrual as if rfv = face_value
      const simDeal = { ...d, remaining_face_value: null };
      const c = computeGsecPerDayAccrual(simDeal, iso, 2);
      csvHas.push({
        deal: d.deal_number, isin: d.isin_number, value_date: vdIso,
        db_face: Number(d.face_value), db_rfv: Number(d.remaining_face_value),
        csv_expected_per_day: csvKey.get(key).perDay,
        simulated_per_day_if_rfv_restored: c.ok ? Number(c.amount) : 0,
      });
    } else {
      genuineSold.push({ deal: d.deal_number, isin: d.isin_number, value_date: vdIso, db_face: Number(d.face_value) });
    }
  }

  const simSum = csvHas.reduce((s, x) => s + x.simulated_per_day_if_rfv_restored, 0);
  const csvSum = csvHas.reduce((s, x) => s + x.csv_expected_per_day, 0);
  console.log(`\n=== Skipped deals that CSV expects to still accrue (${csvHas.length} deals) ===`);
  csvHas.forEach(x => console.log(' ', x));
  console.log(`\nSum if rfv restored : ${simSum.toFixed(2)}  (matches CSV sum? CSV=${csvSum.toFixed(2)})`);
  console.log(`\n=== Skipped deals NOT in CSV (${genuineSold.length} deals - genuinely sold out, OK to skip) ===`);
  genuineSold.forEach(x => console.log(' ', x));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
