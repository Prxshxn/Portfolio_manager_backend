const db = require('../config/database');
const { pricePer100FromYield } = require('../utils/bondPricing');
const tbillPricingService = require('./tbillPricingService');
const { getSystemDay } = require('../models/systemDayModel');

const ISIN_SELECT = `
  isin_number,
  isin_issuer,
  issue_date,
  maturity_date,
  coupon_rate,
  coupon_date_1,
  coupon_date_2,
  series,
  day_basis
`;

function normalizeSeries(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function trimIsin(value) {
  return String(value || '').trim();
}

function instrumentTypeFromIsin(isinNumber, couponRate) {
  const isin = trimIsin(isinNumber).toUpperCase();
  if (isin.startsWith('LKA')) return 'T_BILL';
  if (isin.startsWith('LKB')) return 'T_BOND';
  return Number(couponRate) > 0 ? 'T_BOND' : 'T_BILL';
}

function ymd(value) {
  if (!value) return '';
  const s = typeof value === 'string' ? value.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(fromYmd, toYmd) {
  const a = Date.parse(`${ymd(fromYmd)}T00:00:00Z`);
  const b = Date.parse(`${ymd(toYmd)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Map CBSL T-bill tenor labels (e.g. "3 Month") to approximate days. */
function tenorLabelToDays(label) {
  const s = String(label || '').trim().toLowerCase();
  if (!s) return null;
  const range = s.match(/^(\d+)\s*-\s*(\d+)\s*days?$/);
  if (range) {
    return Math.round((Number(range[1]) + Number(range[2])) / 2);
  }
  const days = s.match(/^(\d+)\s*days?$/);
  if (days) return Number(days[1]);
  const months = s.match(/^(\d+)\s*months?$/);
  if (months) return Number(months[1]) * 30;
  const years = s.match(/^(\d+)\s*years?$/);
  if (years) return Number(years[1]) * 365;
  return null;
}

function interpolateYield(targetDays, points) {
  const pts = (points || [])
    .filter((p) => Number.isFinite(p.days) && Number.isFinite(p.yield))
    .sort((a, b) => a.days - b.days);
  if (!pts.length || !Number.isFinite(targetDays)) return null;
  if (targetDays <= pts[0].days) return pts[0].yield;
  const last = pts[pts.length - 1];
  if (targetDays >= last.days) return last.yield;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const left = pts[i];
    const right = pts[i + 1];
    if (targetDays >= left.days && targetDays <= right.days) {
      if (right.days === left.days) return left.yield;
      const t = (targetDays - left.days) / (right.days - left.days);
      return left.yield + t * (right.yield - left.yield);
    }
  }
  return last.yield;
}

class MarkToMarketService {
  async resolveValueDate() {
    try {
      const sys = await getSystemDay();
      const fromSys = ymd(sys && sys.system_date);
      if (fromSys) return fromSys;
    } catch (error) {
      console.warn('Could not read system_day for MTM value date:', error.message);
    }
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * @param {Array|{bonds?: Array, bills?: Array}} extractedData
   * @param {string} excelSource
   */
  async updateMarkToMarketData(extractedData, excelSource) {
    const bonds = Array.isArray(extractedData)
      ? extractedData
      : (extractedData && extractedData.bonds) || [];
    const bills = Array.isArray(extractedData)
      ? []
      : (extractedData && extractedData.bills) || [];

    console.log(
      `Updating mark-to-market: ${bonds.length} T-bond quotes, ${bills.length} T-bill quotes from ${excelSource}`
    );

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const quotedIsins = new Set();

    const processRows = async (rows, defaultType) => {
      for (const data of rows) {
        try {
          // Tenor-bucket T-bill rows (no ISIN) feed the curve only — do not upsert.
          if (data.curveOnly) continue;
          const isinDetails = await this.getIsinDetails(data, defaultType);
          if (!isinDetails) {
            skippedCount += 1;
            continue;
          }
          const instrumentType =
            data.instrumentType ||
            instrumentTypeFromIsin(isinDetails.isin_number, isinDetails.coupon_rate);
          const priced = await this.priceIsin({
            isinDetails,
            instrumentType,
            averageYield: data.averageYield,
            buyingPrice: data.buyingPrice,
            sellingPrice: data.sellingPrice,
            averagePrice: data.averagePrice
          });
          await this.upsertMarkToMarketRecord({
            series: isinDetails.series || data.series || trimIsin(isinDetails.isin_number),
            isinNumber: trimIsin(isinDetails.isin_number),
            isinIssuer: isinDetails.isin_issuer,
            maturityDate: data.maturityDate || isinDetails.maturity_date,
            buyingPrice: data.buyingPrice,
            sellingPrice: data.sellingPrice,
            averagePrice: priced.averagePrice,
            buyingYield: data.buyingYield,
            sellingYield: data.sellingYield,
            averageYield: priced.averageYield,
            dirtyPrice: priced.dirtyPrice,
            excelSource,
            instrumentType,
            quoteSource: 'excel'
          });
          quotedIsins.add(trimIsin(isinDetails.isin_number).toUpperCase());
          successCount += 1;
        } catch (error) {
          console.error(`Error processing MTM row ${data.series || data.isinNumber}:`, error);
          errorCount += 1;
        }
      }
    };

    await processRows(bonds, 'T_BOND');
    await processRows(bills, 'T_BILL');

    const billCurvePoints = (bills || [])
      .filter((b) => b && b.curveOnly)
      .map((b) => ({
        days: tenorLabelToDays(b.series),
        yield: Number(b.averageYield)
      }))
      .filter((p) => Number.isFinite(p.days) && p.days > 0 && Number.isFinite(p.yield));

    const syncResults = await this.syncUnquotedFromMaster({
      excelSource: `interpolated-from-${excelSource || 'upload'}`,
      quotedIsins,
      billCurvePoints
    });

    return {
      successCount,
      errorCount,
      skippedCount,
      interpolatedCount: syncResults.interpolatedCount,
      interpolatedErrorCount: syncResults.errorCount
    };
  }

  async getIsinDetails(data, defaultType) {
    const isinNumber = trimIsin(data.isinNumber || data.isin_number);
    if (isinNumber) {
      const [byIsin] = await db.query(
        `SELECT ${ISIN_SELECT} FROM isin_master
         WHERE TRIM(isin_number) COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci
         LIMIT 1`,
        [isinNumber]
      );
      if (byIsin[0]) return byIsin[0];
    }

    const series = normalizeSeries(data.series);
    if (series) {
      const [bySeries] = await db.query(
        `SELECT ${ISIN_SELECT} FROM isin_master
         WHERE REPLACE(LOWER(TRIM(series)), ' ', '') = ?
         LIMIT 1`,
        [series]
      );
      if (bySeries[0]) return bySeries[0];
    }

    if (data.maturityDate && defaultType === 'T_BILL') {
      const [byMaturity] = await db.query(
        `SELECT ${ISIN_SELECT} FROM isin_master
         WHERE DATE(maturity_date) = DATE(?)
           AND UPPER(TRIM(isin_number)) LIKE 'LKA%'
         LIMIT 1`,
        [ymd(data.maturityDate)]
      );
      if (byMaturity[0]) return byMaturity[0];
    }

    return null;
  }

  async priceIsin({ isinDetails, instrumentType, averageYield, buyingPrice, sellingPrice, averagePrice }) {
    const yieldRate = Number(averageYield);
    let dirtyPrice = null;
    if (instrumentType === 'T_BILL') {
      dirtyPrice = await this.calculateTbillPrice({
        averageYield: yieldRate,
        maturityDate: isinDetails.maturity_date
      });
    } else {
      dirtyPrice = await this.calculateDirtyPrice({
        isinNumber: isinDetails.isin_number,
        averageYield: yieldRate,
        maturityDate: isinDetails.maturity_date,
        issueDate: isinDetails.issue_date,
        couponRate: isinDetails.coupon_rate,
        couponDate1: isinDetails.coupon_date_1,
        couponDate2: isinDetails.coupon_date_2
      });
    }

    const avgPrice =
      averagePrice ||
      (buyingPrice && sellingPrice ? (Number(buyingPrice) + Number(sellingPrice)) / 2 : null) ||
      buyingPrice ||
      sellingPrice ||
      dirtyPrice;

    return {
      dirtyPrice,
      averagePrice: avgPrice,
      averageYield: Number.isFinite(yieldRate) ? yieldRate : null
    };
  }

  async calculateTbillPrice({ averageYield, maturityDate }) {
    if (!averageYield || !maturityDate) return null;
    const valueDate = await this.resolveValueDate();
    const result = tbillPricingService.compute({
      valueDate,
      maturityDate: ymd(maturityDate),
      faceValue: 100,
      discountRatePercent: parseFloat(averageYield)
    });
    if (!result.ok) {
      console.warn('T-bill MTM price failed:', result.error);
      return null;
    }
    return result.pricePer100;
  }

  async calculateDirtyPrice({
    isinNumber,
    averageYield,
    maturityDate,
    issueDate,
    couponRate,
    couponDate1,
    couponDate2
  }) {
    try {
      if (!averageYield || !maturityDate || !issueDate || !couponRate) {
        return null;
      }
      const valueDate = await this.resolveValueDate();
      const pricingResult = pricePer100FromYield({
        couponRate: parseFloat(couponRate),
        yieldRate: parseFloat(averageYield),
        valueDate,
        maturityDate: ymd(maturityDate),
        issueDate: ymd(issueDate),
        couponDate1: couponDate1 || '',
        couponDate2: couponDate2 || ''
      });
      return parseFloat(pricingResult.dirtyPrice) || null;
    } catch (error) {
      console.error(`Error calculating dirty price for ${isinNumber}:`, error);
      return null;
    }
  }

  async upsertMarkToMarketRecord(data) {
    const sql = `
      INSERT INTO mark_to_market (
        series,
        isin_number,
        instrument_type,
        isin_issuer,
        maturity_date,
        buying_price,
        selling_price,
        average_price,
        buying_yield,
        selling_yield,
        average_yield,
        dirty_price,
        excel_source,
        quote_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        instrument_type = VALUES(instrument_type),
        isin_issuer = VALUES(isin_issuer),
        maturity_date = VALUES(maturity_date),
        buying_price = VALUES(buying_price),
        selling_price = VALUES(selling_price),
        average_price = VALUES(average_price),
        buying_yield = VALUES(buying_yield),
        selling_yield = VALUES(selling_yield),
        average_yield = VALUES(average_yield),
        dirty_price = VALUES(dirty_price),
        excel_source = VALUES(excel_source),
        quote_source = VALUES(quote_source),
        last_updated = CURRENT_TIMESTAMP
    `;

    const values = [
      data.series || trimIsin(data.isinNumber),
      trimIsin(data.isinNumber),
      data.instrumentType || instrumentTypeFromIsin(data.isinNumber),
      data.isinIssuer,
      data.maturityDate,
      data.buyingPrice,
      data.sellingPrice,
      data.averagePrice,
      data.buyingYield,
      data.sellingYield,
      data.averageYield,
      data.dirtyPrice,
      data.excelSource,
      data.quoteSource || 'excel'
    ];

    await db.query(sql, values);
  }

  curveFromRows(rows, valueDate) {
    return (rows || [])
      .map((row) => ({
        days: daysBetween(valueDate, row.maturity_date),
        yield: Number(row.average_yield)
      }))
      .filter((p) => p.days != null && p.days > 0 && Number.isFinite(p.yield));
  }

  /**
   * Price every live isin_master row that is not already excel-quoted.
   */
  async syncUnquotedFromMaster({ excelSource, quotedIsins, billCurvePoints } = {}) {
    const valueDate = await this.resolveValueDate();
    const quoted = quotedIsins instanceof Set ? quotedIsins : new Set();
    let interpolatedCount = 0;
    let errorCount = 0;

    const [liveIsins] = await db.query(
      `SELECT ${ISIN_SELECT}
       FROM isin_master
       WHERE maturity_date IS NULL OR DATE(maturity_date) >= DATE(?)`,
      [valueDate]
    );

    const [mtmRows] = await db.query(
      `SELECT series, isin_number, instrument_type, maturity_date, average_yield,
              buying_price, selling_price, average_price, quote_source
       FROM mark_to_market`
    );

    const excelQuoted = new Set(
      mtmRows
        .filter((row) => String(row.quote_source || '').toLowerCase() === 'excel')
        .map((row) => trimIsin(row.isin_number).toUpperCase())
    );
    for (const isin of quoted) excelQuoted.add(String(isin).toUpperCase());

    const excelBondCurve = this.curveFromRows(
      mtmRows.filter(
        (row) =>
          String(row.quote_source || '').toLowerCase() === 'excel' &&
          String(row.instrument_type || instrumentTypeFromIsin(row.isin_number)).toUpperCase() !== 'T_BILL'
      ),
      valueDate
    );
    let excelBillCurve = this.curveFromRows(
      mtmRows.filter(
        (row) =>
          String(row.quote_source || '').toLowerCase() === 'excel' &&
          String(row.instrument_type || instrumentTypeFromIsin(row.isin_number)).toUpperCase() === 'T_BILL'
      ),
      valueDate
    );
    const uploadBillCurve = (billCurvePoints || []).filter(
      (p) => Number.isFinite(p.days) && p.days > 0 && Number.isFinite(p.yield)
    );
    if (uploadBillCurve.length) {
      excelBillCurve = uploadBillCurve;
    }
    if (!excelBillCurve.length) excelBillCurve = excelBondCurve;

    const fallbackCurve = this.curveFromRows(mtmRows, valueDate);
    const bondCurve = excelBondCurve.length ? excelBondCurve : fallbackCurve;
    const billCurve = excelBillCurve.length ? excelBillCurve : fallbackCurve;

    for (const isinDetails of liveIsins) {
      const isinKey = trimIsin(isinDetails.isin_number).toUpperCase();
      if (!isinKey || excelQuoted.has(isinKey)) continue;
      try {
        const instrumentType = instrumentTypeFromIsin(isinDetails.isin_number, isinDetails.coupon_rate);
        const days = daysBetween(valueDate, isinDetails.maturity_date);
        const curve = instrumentType === 'T_BILL' ? billCurve : bondCurve;
        const interpolatedYield = interpolateYield(days, curve);
        if (!Number.isFinite(interpolatedYield)) continue;

        const priced = await this.priceIsin({
          isinDetails,
          instrumentType,
          averageYield: interpolatedYield,
          averagePrice: null
        });

        await this.upsertMarkToMarketRecord({
          series: isinDetails.series || isinKey,
          isinNumber: trimIsin(isinDetails.isin_number),
          isinIssuer: isinDetails.isin_issuer,
          maturityDate: isinDetails.maturity_date,
          buyingPrice: priced.averagePrice,
          sellingPrice: priced.averagePrice,
          averagePrice: priced.averagePrice,
          buyingYield: interpolatedYield,
          sellingYield: interpolatedYield,
          averageYield: interpolatedYield,
          dirtyPrice: priced.dirtyPrice,
          excelSource: excelSource || 'interpolated-from-existing-curve',
          instrumentType,
          quoteSource: 'interpolated'
        });
        interpolatedCount += 1;
      } catch (error) {
        console.error(`Failed interpolating MTM for ${isinDetails.isin_number}:`, error);
        errorCount += 1;
      }
    }

    return { interpolatedCount, errorCount };
  }

  async syncIsin(isinNumber) {
    const isin = trimIsin(isinNumber);
    if (!isin) return null;
    try {
      await this.syncUnquotedFromMaster({
        excelSource: 'interpolated-from-existing-curve',
        quotedIsins: new Set()
      });
    } catch (error) {
      console.error(`MTM sync after ISIN save failed for ${isin}:`, error);
    }
    return null;
  }

  async getAllMarkToMarketData() {
    const sql = `
      SELECT
        mtm.series,
        mtm.isin_number,
        mtm.instrument_type,
        mtm.isin_issuer,
        mtm.maturity_date,
        mtm.buying_price,
        mtm.selling_price,
        mtm.average_price,
        mtm.buying_yield,
        mtm.selling_yield,
        mtm.average_yield,
        mtm.dirty_price,
        mtm.last_updated,
        mtm.excel_source,
        mtm.quote_source,
        im.issue_date,
        im.coupon_rate,
        im.coupon_date_1,
        im.coupon_date_2
      FROM mark_to_market mtm
      LEFT JOIN isin_master im
        ON TRIM(mtm.isin_number) COLLATE utf8mb4_unicode_ci = TRIM(im.isin_number) COLLATE utf8mb4_unicode_ci
      ORDER BY mtm.instrument_type, mtm.series, mtm.last_updated DESC
    `;

    const [rows] = await db.query(sql);
    const updatedRows = await Promise.all(
      rows.map(async (record) => {
        try {
          const instrumentType =
            record.instrument_type || instrumentTypeFromIsin(record.isin_number, record.coupon_rate);
          const priced = await this.priceIsin({
            isinDetails: record,
            instrumentType,
            averageYield: record.average_yield,
            averagePrice: record.average_price
          });
          return {
            ...record,
            instrument_type: instrumentType,
            quote_source: record.quote_source || 'excel',
            dirty_price: priced.dirtyPrice || record.dirty_price
          };
        } catch (error) {
          return record;
        }
      })
    );
    return updatedRows;
  }

  async getMarkToMarketBySeries(series) {
    const [rows] = await db.query(
      `SELECT mtm.*, im.issue_date, im.coupon_rate, im.coupon_date_1, im.coupon_date_2
       FROM mark_to_market mtm
       LEFT JOIN isin_master im
         ON TRIM(mtm.isin_number) COLLATE utf8mb4_unicode_ci = TRIM(im.isin_number) COLLATE utf8mb4_unicode_ci
       WHERE REPLACE(LOWER(TRIM(mtm.series)), ' ', '') = ?
       ORDER BY mtm.last_updated DESC
       LIMIT 1`,
      [normalizeSeries(series)]
    );
    if (!rows.length) return null;
    const record = rows[0];
    const instrumentType =
      record.instrument_type || instrumentTypeFromIsin(record.isin_number, record.coupon_rate);
    const priced = await this.priceIsin({
      isinDetails: record,
      instrumentType,
      averageYield: record.average_yield,
      averagePrice: record.average_price
    });
    return {
      ...record,
      instrument_type: instrumentType,
      dirty_price: priced.dirtyPrice || record.dirty_price
    };
  }

  async getSummaryStatistics() {
    const [rows] = await db.query(`
      SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT series) as unique_series,
        SUM(CASE WHEN instrument_type = 'T_BILL' THEN 1 ELSE 0 END) as tbill_records,
        SUM(CASE WHEN quote_source = 'interpolated' THEN 1 ELSE 0 END) as interpolated_records,
        AVG(average_yield) as avg_yield,
        AVG(average_price) as avg_price,
        MAX(last_updated) as last_update
      FROM mark_to_market
    `);
    return rows[0];
  }

  formatDate(date) {
    return ymd(date);
  }

  formatCouponDate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${month}-${day}`;
  }
}

module.exports = new MarkToMarketService();
