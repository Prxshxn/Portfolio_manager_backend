const db = require('../config/database');
const Gsec = require('../models/gsec');

const BUY_STATUSES = "('Approved', 'Settled', 'final_approved')";

function dayBefore(ymd) {
  const dt = new Date(`${ymd}T12:00:00`);
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function mapBuyDealRow(d) {
  return {
    id: d.id,
    deal_number: d.deal_number,
    transaction_type: 'Buy',
    value_date: d.value_date,
    face_value: Number(d.face_value) || 0,
    amount: Number(d.remaining_face_value) || 0,
    custodian: d.custodian || '',
    status: d.status
  };
}

function mapGsecFlowRow(row, transactionType) {
  return {
    id: row.id,
    deal_number: row.deal_number,
    transaction_type: transactionType,
    value_date: row.value_date,
    face_value: Number(row.face_value) || 0,
    amount: Number(row.face_value) || 0,
    custodian: row.custodian || '',
    status: row.status
  };
}

/**
 * Daily Portfolio Balancing Report - one row per ISIN, as-at a given date:
 *   opening_balance + from (inflow) - to (outflow) = closing_balance
 *
 *   - opening_balance: available balance for the ISIN as of the day before
 *   - from: total face value of Buy deals value-dated this day (inflow)
 *   - to: total face value of Sell deals value-dated this day (outflow)
 *   - sell_buy / buy_sell: same day's Sell/Buy face value totals in thousands
 *   - closing_balance: opening + from - to
 *   - custodian columns: closing remaining balance split by custodian
 *   - in_hand: closing balance not attributed to a named custodian
 */
exports.getDailyPortfolioBalance = async (asAtDate) => {
  if (!asAtDate) throw new Error('asAtDate is required');

  const [isinRows] = await db.query(`
    SELECT DISTINCT g.isin_number AS isin, im.coupon_rate, im.maturity_date
    FROM gsec g
    LEFT JOIN isin_master im ON im.isin_number COLLATE utf8mb4_unicode_ci = g.isin_number COLLATE utf8mb4_unicode_ci
    WHERE g.transaction_type = 'Buy' AND g.status = 'final_approved'
    ORDER BY g.isin_number
  `);

  const priorDate = dayBefore(asAtDate);
  const rows = [];

  for (const isinRow of isinRows) {
    const isin = isinRow.isin;

    const openingBalance = await Gsec.getOpeningBalance(isin, null, priorDate);

    const [[fromRow]] = await db.query(`
      SELECT COALESCE(SUM(face_value), 0) AS total
      FROM gsec
      WHERE transaction_type = 'Buy' AND status IN ${BUY_STATUSES}
        AND isin_number = ? AND DATE(value_date) = DATE(?)
    `, [isin, asAtDate]);

    const [[toRow]] = await db.query(`
      SELECT COALESCE(SUM(face_value), 0) AS total
      FROM gsec
      WHERE transaction_type = 'Sell' AND status <> 'rejected'
        AND isin_number = ? AND DATE(value_date) = DATE(?)
    `, [isin, asAtDate]);

    const fromAmount = Number(fromRow.total) || 0;
    const toAmount = Number(toRow.total) || 0;
    const closingBalance = openingBalance + fromAmount - toAmount;

    if (openingBalance === 0 && closingBalance === 0 && fromAmount === 0 && toAmount === 0) {
      continue;
    }

    const expectedClosing = await Gsec.getOpeningBalance(isin, null, asAtDate);
    const reconciled = Math.abs(closingBalance - expectedClosing) < 0.01;
    if (!reconciled) {
      console.warn(
        `[dailyPortfolioBalance] ISIN ${isin} asAt ${asAtDate}: closing ${closingBalance} != expected ${expectedClosing}`
      );
    }

    const closingDeals = await Gsec.getBuyDealsWithBalanceFiltered(isin, null, asAtDate);
    const custodianTotals = {};
    let classifiedTotal = 0;
    for (const d of closingDeals) {
      const remaining = Number(d.remaining_face_value) || 0;
      const key = (d.custodian || '').trim();
      if (!key) continue;
      custodianTotals[key] = (custodianTotals[key] || 0) + remaining;
      classifiedTotal += remaining;
    }
    const inHand = Math.max(0, closingBalance - classifiedTotal);

    rows.push({
      maturity_date: isinRow.maturity_date,
      isin,
      coupon_rate: isinRow.coupon_rate,
      opening_balance: openingBalance,
      sell_buy: toAmount / 1000,
      buy_sell: fromAmount / 1000,
      from: fromAmount,
      to: toAmount,
      closing_balance: closingBalance,
      custodians: custodianTotals,
      in_hand: inHand,
      reconciled,
      expected_closing: expectedClosing
    });
  }

  const custodianNames = [...new Set(rows.flatMap((r) => Object.keys(r.custodians)))].sort();

  const totals = rows.reduce((acc, r) => {
    acc.opening_balance += r.opening_balance;
    acc.from += r.from;
    acc.to += r.to;
    acc.closing_balance += r.closing_balance;
    acc.in_hand += r.in_hand;
    for (const name of custodianNames) {
      acc.custodians[name] = (acc.custodians[name] || 0) + (r.custodians[name] || 0);
    }
    return acc;
  }, { opening_balance: 0, from: 0, to: 0, closing_balance: 0, in_hand: 0, custodians: {} });

  return { asAtDate, rows, custodianNames, totals };
};

const VALID_METRICS = ['opening_balance', 'from', 'to', 'closing_balance', 'custodian', 'in_hand'];

/**
 * Deal-level breakdown for a single figure cell in the Daily Portfolio Balancing Report.
 */
exports.getDailyPortfolioBalanceBreakdown = async (asAtDate, isin, metric, custodian = null) => {
  if (!asAtDate || !isin || !metric) {
    throw new Error('asAtDate, isin and metric are required');
  }
  if (!VALID_METRICS.includes(metric)) {
    throw new Error(`Invalid metric: ${metric}. Must be one of: ${VALID_METRICS.join(', ')}`);
  }

  const priorDate = dayBefore(asAtDate);
  let deals = [];

  if (metric === 'opening_balance') {
    const buyDeals = await Gsec.getBuyDealsWithBalanceFiltered(isin, null, priorDate);
    deals = buyDeals.map(mapBuyDealRow);
  } else if (metric === 'closing_balance') {
    const buyDeals = await Gsec.getBuyDealsWithBalanceFiltered(isin, null, asAtDate);
    deals = buyDeals.map(mapBuyDealRow);
  } else if (metric === 'from') {
    const [rows] = await db.query(`
      SELECT id, deal_number, value_date, face_value, custodian, status
      FROM gsec
      WHERE transaction_type = 'Buy' AND status IN ${BUY_STATUSES}
        AND isin_number = ? AND DATE(value_date) = DATE(?)
      ORDER BY deal_number
    `, [isin, asAtDate]);
    deals = rows.map((r) => mapGsecFlowRow(r, 'Buy'));
  } else if (metric === 'to') {
    const [rows] = await db.query(`
      SELECT id, deal_number, value_date, face_value, custodian, status
      FROM gsec
      WHERE transaction_type = 'Sell' AND status <> 'rejected'
        AND isin_number = ? AND DATE(value_date) = DATE(?)
      ORDER BY deal_number
    `, [isin, asAtDate]);
    deals = rows.map((r) => mapGsecFlowRow(r, 'Sell'));
  } else if (metric === 'custodian') {
    if (!custodian) throw new Error('custodian is required for custodian metric');
    const buyDeals = await Gsec.getBuyDealsWithBalanceFiltered(isin, null, asAtDate);
    const key = String(custodian).trim();
    deals = buyDeals
      .filter((d) => (d.custodian || '').trim() === key)
      .map(mapBuyDealRow);
  } else if (metric === 'in_hand') {
    const buyDeals = await Gsec.getBuyDealsWithBalanceFiltered(isin, null, asAtDate);
    deals = buyDeals
      .filter((d) => !(d.custodian || '').trim())
      .map(mapBuyDealRow);
  }

  const total = deals.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  return { asAtDate, isin, metric, custodian: custodian || null, deals, total };
};
