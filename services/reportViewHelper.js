function isTransactionsView(view) {
  const v = String(view || '').trim().toLowerCase();
  return v === 'transactions' || v === 'transaction';
}

function toYmd(val) {
  if (!val) return null;
  const s = String(val).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Inclusive value-date range for a transaction blotter.
 * Prefers dateFrom/dateTo; falls back to a single-day range from valueDate or asAtDate.
 */
function resolveTransactionDateRange({ dateFrom, dateTo, asAtDate, valueDate } = {}) {
  let from = toYmd(dateFrom);
  let to = toYmd(dateTo);
  if (!from && !to) {
    const legacy = toYmd(valueDate) || toYmd(asAtDate);
    if (legacy) {
      from = legacy;
      to = legacy;
    }
  }
  if (from && to && from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  return { from, to };
}

function pushValueDateRange(whereParts, params, columnSql, range) {
  if (!range) return;
  if (range.from && range.to) {
    whereParts.push(`DATE(${columnSql}) BETWEEN DATE(?) AND DATE(?)`);
    params.push(range.from, range.to);
  } else if (range.from) {
    whereParts.push(`DATE(${columnSql}) >= DATE(?)`);
    params.push(range.from);
  } else if (range.to) {
    whereParts.push(`DATE(${columnSql}) <= DATE(?)`);
    params.push(range.to);
  }
}

function appendValueDateRange(sql, params, columnSql, range) {
  const parts = [];
  pushValueDateRange(parts, params, columnSql, range);
  if (!parts.length) return sql;
  return `${sql} AND ${parts.join(' AND ')}`;
}

module.exports = {
  isTransactionsView,
  resolveTransactionDateRange,
  pushValueDateRange,
  appendValueDateRange
};
