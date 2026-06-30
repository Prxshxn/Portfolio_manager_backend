const db = require('../config/database');
const Gsec = require('../models/gsec');

const dayBefore = (dateStr) => {
  const dt = new Date(dateStr);
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);
};

/**
 * Daily Portfolio Balancing Report - one row per ISIN, as-at a given date:
 *   opening_balance + from (inflow) - to (outflow) = closing_balance
 * (verified against the client's own sample numbers, e.g. 1,500,000 opening
 * - 200,000 outflow = 1,300,000 closing).
 *
 * Column interpretation (the client's sample has two pairs of similar-looking
 * columns - Sell/Buy & Buy/Sell vs from/to - at different scales, e.g.
 * "30"/"10" next to "100,000". Since from/to are the ones whose arithmetic
 * was confirmed against the sample, those drive the balance; Sell/Buy and
 * Buy/Sell are kept as the face-value totals of the day's Sell and Buy deals
 * respectively, in thousands, matching the client's "different units"
 * clarification. Flagged for confirmation once the client reviews this.):
 *   - opening_balance: available balance for the ISIN as of the day before
 *   - from: total face value of Buy deals value-dated this day (inflow)
 *   - to: total face value of Sell deals value-dated this day (outflow)
 *   - sell_buy / buy_sell: same day's Sell/Buy face value totals, in
 *     thousands, as a compact activity indicator
 *   - closing_balance: opening + from - to
 *   - custodian columns: closing balance split by custodian (gsec.custodian,
 *     populated going forward at deal entry - historical rows show blank
 *     and roll up into "IN HAND")
 */
exports.getDailyPortfolioBalance = async (asAtDate) => {
  if (!asAtDate) throw new Error('asAtDate is required');

  // ISINs with any Buy activity (current or historical) - the universe of
  // positions this report can speak to.
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

    // Opening balance: available balance for this ISIN (all portfolios) as
    // of the day before, reusing the already-tested opening-balance helper.
    const openingBalance = await Gsec.getOpeningBalance(isin, null, priorDate);

    const [[fromRow]] = await db.query(`
      SELECT COALESCE(SUM(face_value), 0) AS total
      FROM gsec
      WHERE transaction_type = 'Buy' AND status = 'final_approved'
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
      continue; // No activity and no holding - skip from the report.
    }

    // Custodian breakdown of the closing balance: sum of remaining face
    // value across this ISIN's open Buy deals, grouped by custodian.
    const [custodianRows] = await db.query(`
      SELECT custodian, SUM(face_value) AS face_total
      FROM gsec
      WHERE transaction_type = 'Buy' AND status = 'final_approved' AND isin_number = ?
      GROUP BY custodian
    `, [isin]);

    const custodianTotals = {};
    let classifiedTotal = 0;
    for (const c of custodianRows) {
      const key = (c.custodian || '').trim();
      if (!key) continue;
      const amount = Number(c.face_total) || 0;
      custodianTotals[key] = (custodianTotals[key] || 0) + amount;
      classifiedTotal += amount;
    }
    // "IN HAND" = whatever of the closing balance isn't attributed to a
    // named custodian (unclassified historical rows, or genuinely uncustodied).
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
      in_hand: inHand
    });
  }

  // Distinct custodian names across all rows, for consistent column ordering.
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
