const express = require('express');
const router = express.Router();
const db = require('../config/database');

/**
 * GET /api/reports/interest-income
 * Returns interest income breakup by product and ISIN for a date range.
 *
 * Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), product (gsec|tbill|money_market|all)
 */
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, product } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const rows = [];

    // ── GSec accruals ────────────────────────────────────────────────────────
    if (!product || product === 'all' || product === 'gsec') {
      const [gsec] = await db.query(
        `SELECT
           'GSec' AS product_type,
           g.isin_number AS isin,
           g.deal_number,
           g.portfolio,
           g.face_value,
           COALESCE(im.coupon_rate, 0)        AS coupon_rate,
           g.value_date,
           g.maturity_date,
           COALESCE(g.per_day_accrual, 0)     AS daily_accrual,
           DATEDIFF(LEAST(g.maturity_date, ?), GREATEST(g.value_date, ?)) AS accrual_days,
           ROUND(
             COALESCE(g.per_day_accrual, 0)
               * DATEDIFF(LEAST(g.maturity_date, ?), GREATEST(g.value_date, ?)),
             2
           ) AS period_interest
         FROM gsec g
         LEFT JOIN isin_master im
           ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
         WHERE g.transaction_type = 'Buy'
           AND g.status = 'final_approved'
           AND g.value_date <= ?
           AND g.maturity_date >= ?
         ORDER BY g.isin_number, g.deal_number`,
        [endDate, startDate, endDate, startDate, endDate, startDate]
      );
      rows.push(...gsec.map(r => ({ ...r, period_interest: Number(r.period_interest) || 0 })));
    }

    // ── T-Bill discount income ───────────────────────────────────────────────
    if (!product || product === 'all' || product === 'tbill') {
      const [tbill] = await db.query(
        `SELECT
           'T-Bill' AS product_type,
           t.isin_number AS isin,
           t.deal_number,
           t.portfolio_id AS portfolio,
           t.face_value,
           t.discount_rate_pct AS coupon_rate,
           t.value_date,
           t.maturity_date,
           COALESCE(t.per_day_accrual, 0)              AS daily_accrual,
           COALESCE(t.accrued_interest_to_date, 0)     AS cumulative_accrual,
           DATEDIFF(LEAST(t.maturity_date, ?), GREATEST(t.value_date, ?)) AS accrual_days,
           ROUND(
             (t.face_value - t.settlement_amount)
               * DATEDIFF(LEAST(t.maturity_date, ?), GREATEST(t.value_date, ?))
               / GREATEST(DATEDIFF(t.maturity_date, t.value_date), 1),
             2
           ) AS period_interest
         FROM tbill t
         WHERE t.transaction_type = 'Buy'
           AND t.status = 'final_approved'
           AND t.value_date <= ?
           AND t.maturity_date >= ?
         ORDER BY t.isin_number, t.deal_number`,
        [endDate, startDate, endDate, startDate, endDate, startDate]
      );
      rows.push(...tbill.map(r => ({ ...r, period_interest: Number(r.period_interest) || 0 })));
    }

    // ── Money Market interest ────────────────────────────────────────────────
    if (!product || product === 'all' || product === 'money_market') {
      const [mm] = await db.query(
        `SELECT
           'Money Market' AS product_type,
           NULL AS isin,
           mmd.deal_number,
           NULL AS portfolio,
           mmd.principal_amount AS face_value,
           mmd.interest_rate AS coupon_rate,
           mmd.value_date,
           mmd.maturity_date,
           ROUND(
             mmd.principal_amount * (mmd.interest_rate / 100) / 365,
             4
           ) AS daily_accrual,
           ROUND(
             mmd.principal_amount * (mmd.interest_rate / 100)
               * DATEDIFF(LEAST(mmd.maturity_date, ?), GREATEST(mmd.value_date, ?)) / 365,
             2
           ) AS cumulative_accrual,
           DATEDIFF(LEAST(mmd.maturity_date, ?), GREATEST(mmd.value_date, ?)) AS accrual_days,
           ROUND(
             mmd.principal_amount * (mmd.interest_rate / 100)
               * DATEDIFF(LEAST(mmd.maturity_date, ?), GREATEST(mmd.value_date, ?)) / 365,
             2
           ) AS period_interest
         FROM money_market_deals mmd
         WHERE mmd.status = 'final_approved'
           AND mmd.value_date <= ?
           AND mmd.maturity_date >= ?
         ORDER BY mmd.deal_number`,
        [endDate, startDate, endDate, startDate, endDate, startDate, endDate, startDate]
      );
      rows.push(...mm.map(r => ({ ...r, period_interest: Number(r.period_interest) || 0 })));
    }

    // Summary totals per product
    const summary = {};
    rows.forEach(r => {
      if (!summary[r.product_type]) summary[r.product_type] = { product_type: r.product_type, deal_count: 0, total_face_value: 0, total_period_interest: 0 };
      summary[r.product_type].deal_count += 1;
      summary[r.product_type].total_face_value += Number(r.face_value) || 0;
      summary[r.product_type].total_period_interest += Number(r.period_interest) || 0;
    });

    res.json({
      success: true,
      data: rows,
      summary: Object.values(summary),
      total: rows.length
    });
  } catch (err) {
    console.error('Interest income report error:', err);
    res.status(500).json({ error: 'Failed to generate interest income report', details: err.message });
  }
});

module.exports = router;
