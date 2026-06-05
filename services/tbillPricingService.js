/**
 * T-Bill present-value (yield) pricing (server-side validation).
 * cashPrice = FV / (1 + (r × days / 364)), r = annual discount as decimal, days = ACT calendar days.
 */

const MS_PER_DAY = 86400000;

// Day-count basis for T-Bill discounting (Sri Lanka T-bill convention).
const TBILL_YEAR_BASIS = 364;

function parseYMDUtc(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const t = Date.UTC(y, mo, d);
  return Number.isNaN(t) ? null : t;
}

function daysBetweenYMD(valueDateYmd, maturityDateYmd) {
  const t0 = parseYMDUtc(valueDateYmd);
  const t1 = parseYMDUtc(maturityDateYmd);
  if (t0 == null || t1 == null) return null;
  return Math.round((t1 - t0) / MS_PER_DAY);
}

function compute({ valueDate, maturityDate, faceValue, discountRatePercent }) {
  const days = daysBetweenYMD(valueDate, maturityDate);
  const fv = parseFloat(faceValue);
  const pct = parseFloat(discountRatePercent);
  if (days == null || !Number.isFinite(fv) || fv <= 0 || !Number.isFinite(pct)) {
    return { ok: false, error: 'Invalid value date, maturity date, face value, or discount rate' };
  }
  if (days <= 0) {
    return { ok: false, error: 'Value date must be before maturity date' };
  }
  const r = pct / 100;
  const denominator = 1 + (r * days) / TBILL_YEAR_BASIS;
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return { ok: false, error: 'Invalid discount — check rate and days' };
  }
  const factor = 1 / denominator;
  // Round quoted price per 100 to 4 decimals, then derive settlement from it
  // so the cash amount matches the displayed price exactly.
  const pricePer100 = Math.round(100 * factor * 10000) / 10000;
  const cashPrice = fv * (pricePer100 / 100);
  return {
    ok: true,
    days,
    cashPrice,
    pricePer100,
    discountEarned: fv - cashPrice
  };
}

module.exports = {
  daysBetweenYMD,
  compute
};
