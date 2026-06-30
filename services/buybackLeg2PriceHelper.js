/** Truncate to 4 decimal places (match buyback pricing convention). */
function truncate4(val) {
  return Math.floor(Number(val) * 10000) / 10000;
}

/** Per-100 bond price is usable (rejects 0, negative, and sentinel garbage). */
function isUsablePricePer100(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || n > 200) return false;
  return true;
}

/**
 * Derive leg2 clean/dirty prices when DB stores 0/NULL or garbage sentinels.
 * Uses settlement amount and face value for dirty; applies leg1 accrued spread for clean.
 */
function deriveLeg2Prices({
  leg1FaceValue,
  leg2FaceValue,
  leg1CleanPrice,
  leg1DirtyPrice,
  leg2CleanPrice,
  leg2DirtyPrice,
  leg2SettlementAmount
}) {
  const fv1 = Number(leg1FaceValue) || 0;
  const fv2 = Number(leg2FaceValue) || fv1;
  const l1Clean = Number(leg1CleanPrice) || 0;
  const l1Dirty = Number(leg1DirtyPrice) || 0;
  const settlement = Number(leg2SettlementAmount) || 0;

  let dirty = isUsablePricePer100(leg2DirtyPrice) ? Number(leg2DirtyPrice) : 0;
  let clean = isUsablePricePer100(leg2CleanPrice) ? Number(leg2CleanPrice) : 0;

  if (!dirty && settlement && fv2) {
    dirty = truncate4((settlement * 100) / fv2);
  }
  if (!clean && dirty && l1Dirty && l1Clean) {
    const leg1AccruedPer100 = l1Dirty - l1Clean;
    clean = truncate4(dirty - leg1AccruedPer100);
  }

  return { leg2CleanPrice: clean, leg2DirtyPrice: dirty, leg2FaceValue: fv2 };
}

module.exports = { truncate4, deriveLeg2Prices, isUsablePricePer100 };