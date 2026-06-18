const db = require('../config/db');

exports.getRepoReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, dealType, page, pageSize }) => {
  // Build query with filters for repo deals (Repo + Reverse Repo)
  let sql = `
    SELECT
      rd.deal_type,
      COALESCE(
        corp.short_name,
        ind.short_name,
        joint.short_name,
        CONCAT('ID:', rd.counterparty_id)
      ) AS counterparty,
      rd.settlement_mode,
      rd.trade_date,
      rd.value_date,
      rd.maturity_date,
      rd.principal_amount,
      rd.rate,
      rd.tenor,
      rd.interest_amount,
      rd.maturity_amount,
      rd.isin_number AS isin,
      rd.face_value_as_per_counterparty
    FROM repo_deals rd
    LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
    LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
    LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
    WHERE 1=1
  `;

  const params = [];

  if (dealType) {
    sql += ' AND rd.deal_type = ?';
    params.push(dealType);
  }

  // Portfolio filter is optional; apply only if repo_deals has such a column (most installs don't)
  // We detect it once per request to avoid SQL errors on schemas without portfolio.
  if (portfolio) {
    try {
      const [cols] = await db.query(
        `SELECT 1 AS ok
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'repo_deals'
            AND COLUMN_NAME = 'portfolio'
          LIMIT 1`
      );
      if (cols && cols.length > 0) {
        sql += ' AND rd.portfolio = ?';
        params.push(portfolio);
      }
    } catch {
      // ignore schema check failures; treat as no portfolio column
    }
  }

  if (isin) {
    sql += ' AND rd.isin_number = ?';
    params.push(isin);
  }

  if (valueDate) {
    sql += ' AND rd.value_date = ?';
    params.push(valueDate);
  }

  if (maturityDate) {
    sql += ' AND rd.maturity_date = ?';
    params.push(maturityDate);
  }

  if (asAtDate) {
    sql += ' AND rd.value_date <= ?';
    params.push(asAtDate);
    // Open positions only as at the report date — exclude matured repo / reverse-repo deals.
    sql += ' AND (rd.maturity_date IS NULL OR DATE(rd.maturity_date) > DATE(?))';
    params.push(asAtDate);
  }

  sql += ' ORDER BY rd.value_date DESC, rd.id DESC';

  // Pagination
  let pageNum = null;
  let pageSizeNum = null;
  if (page && pageSize) {
    pageNum = Number(page);
    pageSizeNum = Number(pageSize);
    const offset = (pageNum - 1) * pageSizeNum;
    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSizeNum, offset);
  }

  const [rows] = await db.query(sql, params);

  // Count total (without pagination)
  let countSql = `
    SELECT COUNT(*) AS count
    FROM repo_deals rd
    WHERE 1=1
  `;
  const countParams = [];

  if (dealType) {
    countSql += ' AND rd.deal_type = ?';
    countParams.push(dealType);
  }

  if (portfolio) {
    try {
      const [cols] = await db.query(
        `SELECT 1 AS ok
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'repo_deals'
            AND COLUMN_NAME = 'portfolio'
          LIMIT 1`
      );
      if (cols && cols.length > 0) {
        countSql += ' AND rd.portfolio = ?';
        countParams.push(portfolio);
      }
    } catch {
      // ignore
    }
  }

  if (isin) {
    countSql += ' AND rd.isin_number = ?';
    countParams.push(isin);
  }
  if (valueDate) {
    countSql += ' AND rd.value_date = ?';
    countParams.push(valueDate);
  }
  if (maturityDate) {
    countSql += ' AND rd.maturity_date = ?';
    countParams.push(maturityDate);
  }
  if (asAtDate) {
    countSql += ' AND rd.value_date <= ?';
    countParams.push(asAtDate);
    countSql += ' AND (rd.maturity_date IS NULL OR DATE(rd.maturity_date) > DATE(?))';
    countParams.push(asAtDate);
  }

  const [[{ count }]] = await db.query(countSql, countParams);

  // Return raw numeric values; frontend formats display and exporter handles formatting.
  const data = rows.map(r => ({
    deal_type: r.deal_type || '',
    counterparty: r.counterparty || '',
    settlement_mode: r.settlement_mode || '',
    trade_date: r.trade_date,
    value_date: r.value_date,
    maturity_date: r.maturity_date,
    principal_amount: r.principal_amount,
    rate: r.rate,
    tenor: r.tenor,
    interest_amount: r.interest_amount,
    maturity_amount: r.maturity_amount,
    isin: r.isin || r.isin_number || '',
    face_value_as_per_counterparty: r.face_value_as_per_counterparty
  }));

  return {
    data,
    total: Number(count) || 0,
    page: pageNum || undefined,
    pageSize: pageSizeNum || undefined
  };
};

