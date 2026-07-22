'use strict';

function parseSellDealAllocations(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Sum sell reductions per buy deal as-of a date.
 * Multi-lot sells store the true split in sell_deal_allocations.
 * Pass { excludeRejected: true } to skip rejected Sells (used by the
 * available-to-sell balance in the sell modal, where a rejected Sell must
 * not keep consuming the Buy deal's balance).
 */
async function buildSoldByDealMap(db, dealNumbers, asAtDate, { excludeRejected = false } = {}) {
  const soldByDeal = {};
  if (!dealNumbers.length) return soldByDeal;

  const dealSet = new Set(dealNumbers.map((d) => String(d || '').trim()).filter(Boolean));
  const normalized = [...dealSet];
  if (!normalized.length) return soldByDeal;

  const placeholders = normalized.map(() => '?').join(',');
  let sql = `
    SELECT TRIM(buy_deal_number) AS buy_deal_number, face_value, sell_deal_allocations
    FROM gsec
    WHERE transaction_type = 'Sell'
      AND (
        TRIM(buy_deal_number) IN (${placeholders})
        OR sell_deal_allocations IS NOT NULL
      )
  `;
  const params = [...normalized];

  if (excludeRejected) {
    sql += " AND COALESCE(status, '') <> 'rejected'";
  }

  if (asAtDate) {
    sql += ' AND DATE(value_date) <= DATE(?)';
    params.push(asAtDate);
  }

  const [sellRows] = await db.query(sql, params);
  for (const row of sellRows) {
    const allocations = parseSellDealAllocations(row.sell_deal_allocations);
    if (allocations) {
      for (const alloc of allocations) {
        const buyDealNumber = String((alloc.deal_number || alloc.buy_deal_number) || '').trim();
        const amount = Number(alloc.amountToSell || alloc.faceValue) || 0;
        if (buyDealNumber && dealSet.has(buyDealNumber) && amount > 0) {
          soldByDeal[buyDealNumber] = (soldByDeal[buyDealNumber] || 0) + amount;
        }
      }
      continue;
    }

    const buyDealNumber = String(row.buy_deal_number || '').trim();
    const amount = Number(row.face_value) || 0;
    if (buyDealNumber && dealSet.has(buyDealNumber) && amount > 0) {
      soldByDeal[buyDealNumber] = (soldByDeal[buyDealNumber] || 0) + amount;
    }
  }

  return soldByDeal;
}

/** Naive legacy sum used by old report/EOD code: SUM(face_value) by buy_deal_number. */
async function buildNaiveSoldByDealMap(db, dealNumbers, asAtDate) {
  const soldByDeal = {};
  if (!dealNumbers.length) return soldByDeal;

  const normalized = [...new Set(dealNumbers.map((d) => String(d || '').trim()).filter(Boolean))];
  const placeholders = normalized.map(() => '?').join(',');
  let sql = `
    SELECT TRIM(buy_deal_number) AS buy_deal_number, COALESCE(SUM(face_value), 0) AS total_sold
    FROM gsec
    WHERE transaction_type = 'Sell'
      AND buy_deal_number IS NOT NULL
      AND TRIM(buy_deal_number) IN (${placeholders})
  `;
  const params = [...normalized];
  if (asAtDate) {
    sql += ' AND DATE(value_date) <= DATE(?)';
    params.push(asAtDate);
  }
  sql += ' GROUP BY TRIM(buy_deal_number)';

  const [rows] = await db.query(sql, params);
  for (const row of rows) {
    const key = String(row.buy_deal_number || '').trim();
    if (key) soldByDeal[key] = Number(row.total_sold) || 0;
  }
  return soldByDeal;
}

/**
 * Buy deals where multi-lot sells caused the legacy SUM(face_value) path to
 * over-deduct the primary buy_deal_number.
 */
async function findMultiLotOvercountDeals(db) {
  const [sellRows] = await db.query(
    `SELECT TRIM(buy_deal_number) AS buy_deal_number, face_value, sell_deal_allocations
     FROM gsec
     WHERE transaction_type = 'Sell' AND sell_deal_allocations IS NOT NULL`
  );
  const affected = new Set();
  for (const row of sellRows) {
    const allocations = parseSellDealAllocations(row.sell_deal_allocations);
    if (!allocations) continue;
    const primaryBuy = String(row.buy_deal_number || '').trim();
    const sellFace = Number(row.face_value) || 0;
    if (!primaryBuy || sellFace <= 0) continue;
    const allocToPrimary = allocations
      .filter((a) => String((a.deal_number || a.buy_deal_number) || '').trim() === primaryBuy)
      .reduce((sum, a) => sum + (Number(a.amountToSell || a.faceValue) || 0), 0);
    if (allocToPrimary > 0 && allocToPrimary < sellFace) {
      affected.add(primaryBuy);
    }
  }
  return affected;
}

module.exports = {
  parseSellDealAllocations,
  buildSoldByDealMap,
  buildNaiveSoldByDealMap,
  findMultiLotOvercountDeals
};
