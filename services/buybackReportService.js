const db = require('../config/db');
const { deriveLeg2Prices } = require('./buybackLeg2PriceHelper');
const { isTransactionsView, resolveTransactionDateRange, pushValueDateRange } = require('./reportViewHelper');

let buybackDealsColumnSetPromise = null;

async function getBuybackDealsColumnSet() {
  if (!buybackDealsColumnSetPromise) {
    buybackDealsColumnSetPromise = db
      .query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'buyback_deals'`
      )
      .then(([rows]) => new Set((rows || []).map((r) => r.COLUMN_NAME)));
  }
  return buybackDealsColumnSetPromise;
}

function formatCurrency(value, decimals = 2) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPrice(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercentage(value, decimals = 4) {
  if (value === null || value === undefined || value === '') return '';
  const num = Number(value);
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

exports.getBuybackReport = async ({ asAtDate, portfolio, isin, valueDate, maturityDate, dateFrom, dateTo, transactionPair, page, pageSize, view }) => {
  // Always refresh the column set so columns added after server start (via ensureColumnExists
  // in BuybackDeal.create) are never missed by a stale module-level cache.
  buybackDealsColumnSetPromise = null;
  const cols = await getBuybackDealsColumnSet();
  const hasVerifiedBy = cols.has('verified_by');
  const hasVerifiedAt = cols.has('verified_at');
  const hasApprovedBy = cols.has('approved_by');
  const hasApprovedAt = cols.has('approved_at');
  const hasLeg1Clean = cols.has('leg1_clean_price');
  const hasLeg1Dirty = cols.has('leg1_dirty_price');
  const hasLeg2Clean = cols.has('leg2_clean_price');
  const hasLeg2Dirty = cols.has('leg2_dirty_price');
  const hasLeg2Face = cols.has('leg2_face_value');
  const hasLeg1AdjustedFace = cols.has('leg1_adjusted_face_value');

  const normalizedPair = String(transactionPair || '').trim().toLowerCase().replace(/[\s-]/g, '_');
  const sellBuyCondition = `(LOWER(TRIM(bd.leg1_transaction_type)) = 'sell' AND LOWER(TRIM(bd.leg2_transaction_type)) = 'buy')`;
  const buySellCondition = `(LOWER(TRIM(bd.leg1_transaction_type)) = 'buy' AND LOWER(TRIM(bd.leg2_transaction_type)) = 'sell')`;

  const whereParts = [];
  if (normalizedPair === 'sell_buy' || normalizedPair === 'sell/buy') {
    whereParts.push(sellBuyCondition);
  } else if (normalizedPair === 'buy_sell' || normalizedPair === 'buy/sell') {
    whereParts.push(buySellCondition);
  } else {
    whereParts.push(`(${sellBuyCondition} OR ${buySellCondition})`);
  }
  const params = [];

  if (portfolio) {
    whereParts.push('(bd.leg1_portfolio = ? OR bd.leg2_portfolio = ?)');
    params.push(portfolio, portfolio);
  }
  if (isin) {
    whereParts.push('(bd.leg1_isin = ? OR bd.leg2_isin = ?)');
    params.push(isin, isin);
  }
  if (maturityDate) {
    whereParts.push('DATE(bd.leg2_value_date) = DATE(?)');
    params.push(maturityDate);
  }
  if (isTransactionsView(view)) {
    const range = resolveTransactionDateRange({ dateFrom, dateTo, asAtDate, valueDate });
    pushValueDateRange(whereParts, params, 'bd.leg1_value_date', range);
  } else {
    if (valueDate) {
      whereParts.push('DATE(bd.leg1_value_date) = DATE(?)');
      params.push(valueDate);
    }
    if (asAtDate) {
      whereParts.push('DATE(bd.leg1_value_date) <= DATE(?)');
      whereParts.push('DATE(bd.leg2_value_date) > DATE(?)');
      params.push(asAtDate, asAtDate);
    }
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const counterpartyJoinSql = `
    LEFT JOIN counterparty_master_corporate corp1
      ON (bd.leg1_counterparty LIKE 'c%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = corp1.id)
      OR (bd.leg1_counterparty = corp1.id)
    LEFT JOIN counterparty_master_individual ind1
      ON (bd.leg1_counterparty LIKE 'i%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = ind1.id)
      OR (bd.leg1_counterparty = ind1.id)
    LEFT JOIN counterparty_master_joint joint1
      ON (bd.leg1_counterparty LIKE 'j%' AND CAST(SUBSTRING(bd.leg1_counterparty, 2) AS UNSIGNED) = joint1.id)
      OR (bd.leg1_counterparty = joint1.id)
    LEFT JOIN counterparty_master_corporate corp2
      ON (bd.leg2_counterparty LIKE 'c%' AND CAST(SUBSTRING(bd.leg2_counterparty, 2) AS UNSIGNED) = corp2.id)
      OR (bd.leg2_counterparty = corp2.id)
    LEFT JOIN counterparty_master_individual ind2
      ON (bd.leg2_counterparty LIKE 'i%' AND CAST(SUBSTRING(bd.leg2_counterparty, 2) AS UNSIGNED) = ind2.id)
      OR (bd.leg2_counterparty = ind2.id)
    LEFT JOIN counterparty_master_joint joint2
      ON (bd.leg2_counterparty LIKE 'j%' AND CAST(SUBSTRING(bd.leg2_counterparty, 2) AS UNSIGNED) = joint2.id)
      OR (bd.leg2_counterparty = joint2.id)
  `;

  const selectSql = `
    SELECT
      bd.id,
      bd.deal_number,
      bd.deal_status,
      bd.created_at,
      bd.leg1_trade_date,
      bd.leg1_value_date,
      bd.leg1_transaction_type,
      bd.leg1_isin,
      bd.leg1_counterparty,
      bd.leg1_portfolio,
      bd.leg1_face_value,
      ${hasLeg1AdjustedFace ? 'bd.leg1_adjusted_face_value' : 'NULL as leg1_adjusted_face_value'},
      bd.leg1_yield_rate,
      bd.leg1_settlement_amount,
      bd.leg1_currency,
      ${hasLeg1Clean ? 'bd.leg1_clean_price' : 'NULL as leg1_clean_price'},
      ${hasLeg1Dirty ? 'bd.leg1_dirty_price' : 'NULL as leg1_dirty_price'},
      ${hasLeg2Clean ? 'bd.leg2_clean_price' : 'NULL as leg2_clean_price'},
      ${hasLeg2Dirty ? 'bd.leg2_dirty_price' : 'NULL as leg2_dirty_price'},
      ${hasLeg2Face ? 'bd.leg2_face_value' : 'NULL as leg2_face_value'},
      bd.leg2_trade_date,
      bd.leg2_value_date,
      bd.leg2_transaction_type,
      bd.leg2_isin,
      bd.leg2_counterparty,
      bd.leg2_portfolio,
      bd.leg2_settlement_amount,
      bd.leg2_currency,
      COALESCE(
        corp1.short_name,
        ind1.short_name,
        joint1.short_name,
        corp2.short_name,
        ind2.short_name,
        joint2.short_name,
        bd.leg1_counterparty,
        bd.leg2_counterparty,
        ''
      ) AS counterparty_name,
      ${hasVerifiedBy ? 'bd.verified_by' : 'NULL as verified_by'},
      ${hasVerifiedAt ? 'bd.verified_at' : 'NULL as verified_at'},
      ${hasApprovedBy ? 'bd.approved_by' : 'NULL as approved_by'},
      ${hasApprovedAt ? 'bd.approved_at' : 'NULL as approved_at'}
    FROM buyback_deals bd
    ${counterpartyJoinSql}
    ${whereSql}
    ORDER BY bd.leg1_value_date DESC, bd.created_at DESC
  `;

  const shouldPaginate = Number.isFinite(Number(page)) && Number(page) > 0
    && Number.isFinite(Number(pageSize)) && Number(pageSize) > 0;

  let paginatedSql = selectSql;
  const paginatedParams = [...params];
  if (shouldPaginate) {
    const limit = Number(pageSize);
    const offset = (Number(page) - 1) * Number(pageSize);
    paginatedSql += ' LIMIT ? OFFSET ?';
    paginatedParams.push(limit, offset);
  }

  const [rows] = await db.query(paginatedSql, paginatedParams);

  const normalizeTx = (tx) => String(tx || '').trim().toLowerCase();
  const toTxPairLabel = (leg1Tx, leg2Tx) => {
    const t1 = normalizeTx(leg1Tx);
    const t2 = normalizeTx(leg2Tx);
    if (t1 === 'sell' && t2 === 'buy') return 'Sell/Buy';
    if (t1 === 'buy' && t2 === 'sell') return 'Buy/Sell';
    return `${leg1Tx || ''}/${leg2Tx || ''}`;
  };
  const dateDiffInDays = (start, end) => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((e - s) / msPerDay);
  };

  const data = rows.map((row) => {
    const leg1FaceValue = Number(row.leg1_face_value) || 0;
    const leg1AdjustedFaceValue = row.leg1_adjusted_face_value !== null && row.leg1_adjusted_face_value !== undefined
      ? Number(row.leg1_adjusted_face_value)
      : leg1FaceValue;
    const leg2SettlementAmount = Number(row.leg2_settlement_amount) || 0;
    const leg1CleanPrice = Number(row.leg1_clean_price) || 0;
    const leg1DirtyPrice = Number(row.leg1_dirty_price) || 0;

    const { leg2CleanPrice, leg2DirtyPrice, leg2FaceValue } = deriveLeg2Prices({
      leg1FaceValue,
      leg2FaceValue: row.leg2_face_value,
      leg1CleanPrice,
      leg1DirtyPrice,
      leg2CleanPrice: row.leg2_clean_price,
      leg2DirtyPrice: row.leg2_dirty_price,
      leg2SettlementAmount
    });

    return {
      id: row.id,
      deal_id: row.id,
      deal_number: row.deal_number,
      portfolio: row.leg1_portfolio || row.leg2_portfolio || '',
      counterparty: row.counterparty_name || row.leg1_counterparty || row.leg2_counterparty || '',
      isin: row.leg1_isin || row.leg2_isin || '',
      face_value: leg1AdjustedFaceValue,
      leg1_clean_price: leg1CleanPrice,
      leg1_dirty_price: leg1DirtyPrice,
      leg1_clean_price_amount: leg1CleanPrice * leg1FaceValue / 100,
      value_date: row.leg1_value_date,
      maturity_date: row.leg2_value_date,
      settlement_value: Number(row.leg1_settlement_amount) || 0,
      maturity_value: leg2SettlementAmount,
      leg2_clean_price: leg2CleanPrice,
      leg2_dirty_price: leg2DirtyPrice,
      leg2_clean_price_amount: leg2CleanPrice * leg2FaceValue / 100,
      rate: Number(row.leg1_yield_rate) || 0,
      dtm: dateDiffInDays(row.leg1_value_date, row.leg2_value_date),
      transaction_type: toTxPairLabel(row.leg1_transaction_type, row.leg2_transaction_type),
      status: row.deal_status,
      currency: row.leg1_currency || row.leg2_currency || 'LKR'
    };
  });

  const countSql = `
    SELECT COUNT(*) AS count
    FROM buyback_deals bd
    ${whereSql}
  `;
  const [[{ count }]] = await db.query(countSql, params);

  return { data, total: Number(count) || 0, totalPortfolioBalance: null };
};
