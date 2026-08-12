/**
 * Read-only audit: multi-lot sells whose sell_deal_allocations do not sum to the
 * deal's own face value.
 *
 * A mismatch means inventory was reduced by a different amount than was actually
 * sold, so buy lots can disappear from (or linger on) the GSEC report incorrectly.
 *
 * Usage:
 *   node scripts/audit-sell-allocation-mismatches.js
 *   node scripts/audit-sell-allocation-mismatches.js --tolerance 1
 *   node scripts/audit-sell-allocation-mismatches.js --csv out.csv
 */

const fs = require('fs');
const db = require('../config/database');
const { parseSellDealAllocations } = require('../services/gsecSellDeductionService');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const TOLERANCE = Number(arg('tolerance', '0.01'));
const CSV_PATH = arg('csv', null);

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function allocTotal(allocations) {
  return allocations.reduce((sum, a) => sum + (Number(a.amountToSell || a.faceValue) || 0), 0);
}

async function columnExists(table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Sells booked on the gsec table. */
async function collectGsecSells() {
  const [rows] = await db.query(
    `SELECT id, deal_number, isin_number, portfolio, value_date, face_value,
            TRIM(buy_deal_number) AS buy_deal_number, sell_deal_allocations, status
     FROM gsec
     WHERE transaction_type = 'Sell' AND sell_deal_allocations IS NOT NULL
     ORDER BY DATE(value_date), id`
  );
  return rows.map((r) => ({
    source: 'gsec',
    id: r.id,
    deal_number: r.deal_number,
    isin: (r.isin_number || '').trim(),
    portfolio: r.portfolio,
    value_date: r.value_date,
    face_value: Number(r.face_value) || 0,
    primary_buy: r.buy_deal_number,
    status: r.status || '',
    allocations: parseSellDealAllocations(r.sell_deal_allocations) || []
  }));
}

/** Leg 1 sells booked on buyback_deals. */
async function collectBuybackSells() {
  if (!(await columnExists('buyback_deals', 'sell_deal_allocations'))) return [];
  const hasAdjusted = await columnExists('buyback_deals', 'leg1_adjusted_face_value');
  const [rows] = await db.query(
    `SELECT id, deal_number, leg1_isin, leg1_portfolio, leg1_value_date, leg1_face_value,
            ${hasAdjusted ? 'leg1_adjusted_face_value' : 'NULL AS leg1_adjusted_face_value'},
            TRIM(source_buy_deal_number) AS source_buy_deal_number, sell_deal_allocations
     FROM buyback_deals
     WHERE sell_deal_allocations IS NOT NULL AND LOWER(leg1_transaction_type) = 'sell'
     ORDER BY DATE(leg1_value_date), id`
  );
  return rows.map((r) => {
    const adjusted = r.leg1_adjusted_face_value;
    const face =
      adjusted !== null && adjusted !== undefined && adjusted !== ''
        ? Number(adjusted)
        : Number(r.leg1_face_value);
    return {
      source: 'buyback',
      id: r.id,
      deal_number: r.deal_number,
      isin: (r.leg1_isin || '').trim(),
      portfolio: r.leg1_portfolio,
      value_date: r.leg1_value_date,
      face_value: Number(face) || 0,
      primary_buy: r.source_buy_deal_number,
      status: '',
      allocations: parseSellDealAllocations(r.sell_deal_allocations) || []
    };
  });
}

(async () => {
  const sells = [...(await collectGsecSells()), ...(await collectBuybackSells())];
  console.log(`Scanned ${sells.length} sell deals carrying allocations.\n`);

  const mismatches = [];
  for (const s of sells) {
    if (!s.allocations.length) continue;
    const total = allocTotal(s.allocations);
    const diff = total - s.face_value;
    if (Math.abs(diff) > TOLERANCE) mismatches.push({ ...s, alloc_total: total, diff });
  }

  if (!mismatches.length) {
    console.log(`No mismatches beyond a tolerance of ${TOLERANCE}.`);
    process.exit(0);
  }

  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Which buy lots each mismatched sell touched, and whether it zeroed them.
  const lotNumbers = [
    ...new Set(
      mismatches.flatMap((m) =>
        m.allocations.map((a) => String(a.deal_number || a.buy_deal_number || '').trim())
      )
    )
  ].filter(Boolean);

  const lotFace = {};
  if (lotNumbers.length) {
    const [lots] = await db.query(
      `SELECT TRIM(deal_number) AS deal_number, face_value, remaining_face_value
       FROM gsec
       WHERE transaction_type = 'Buy' AND TRIM(deal_number) IN (${lotNumbers.map(() => '?').join(',')})`,
      lotNumbers
    );
    lots.forEach((l) => {
      lotFace[l.deal_number] = {
        face: Number(l.face_value) || 0,
        remaining: Number(l.remaining_face_value)
      };
    });
  }

  console.log(`Found ${mismatches.length} sell deal(s) whose allocations do not tie to face value:\n`);
  for (const m of mismatches) {
    const label = m.diff > 0 ? 'OVER-consumes inventory by' : 'UNDER-consumes inventory by';
    console.log(
      `${m.deal_number}  [${m.source}${m.status ? `/${m.status}` : ''}]  isin ${m.isin}  value date ${ymd(m.value_date)}`
    );
    console.log(
      `   face value ${fmt(m.face_value)} | allocated ${fmt(m.alloc_total)} | ${label} ${fmt(Math.abs(m.diff))}`
    );
    for (const a of m.allocations) {
      const dn = String(a.deal_number || a.buy_deal_number || '').trim();
      const amt = Number(a.amountToSell || a.faceValue) || 0;
      const lot = lotFace[dn];
      const lotInfo = lot ? `lot face ${fmt(lot.face)}` : 'lot not found';
      console.log(`      ${dn.padEnd(22)} ${fmt(amt).padStart(18)}   (${lotInfo})`);
    }
    console.log('');
  }

  const overTotal = mismatches.filter((m) => m.diff > 0).reduce((s, m) => s + m.diff, 0);
  const underTotal = mismatches.filter((m) => m.diff < 0).reduce((s, m) => s - m.diff, 0);
  console.log('--- summary ---');
  console.log(`  sells over-consuming inventory : ${mismatches.filter((m) => m.diff > 0).length} (total ${fmt(overTotal)})`);
  console.log(`  sells under-consuming inventory: ${mismatches.filter((m) => m.diff < 0).length} (total ${fmt(underTotal)})`);

  if (CSV_PATH) {
    const lines = ['deal_number,source,status,isin,value_date,face_value,allocated_total,difference'];
    mismatches.forEach((m) => {
      lines.push(
        [m.deal_number, m.source, m.status, m.isin, ymd(m.value_date), m.face_value, m.alloc_total, m.diff].join(',')
      );
    });
    fs.writeFileSync(CSV_PATH, lines.join('\n'), 'utf8');
    console.log(`\nCSV written to ${CSV_PATH}`);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
