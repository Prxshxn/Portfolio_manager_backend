const db = require('../config/db');
const dealConfirmationService = require('../services/dealConfirmationService');

function buildRefNumber(prefix, dealNumber) {
  const tail = String(dealNumber || '').replace(/[^0-9]/g, '').slice(-6) || '000001';
  return `${prefix}${tail}`;
}

async function getGsecConfirmationContent(id) {
  const [rows] = await db.query(
    `SELECT g.*, im.coupon_rate AS isin_coupon_rate
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.id = ? LIMIT 1`,
    [id]
  );
  const deal = rows[0];
  if (!deal) {
    const err = new Error('Deal not found');
    err.status = 404;
    throw err;
  }

  const isBuy = String(deal.transaction_type).toLowerCase() === 'buy';
  const couponRate = deal.coupon_rate ?? deal.isin_coupon_rate;
  const dirtyPrice = deal.dirty_price != null ? Number(deal.dirty_price) : null;

  return dealConfirmationService.buildGsecLegContent({
    refNumber: buildRefNumber(isBuy ? 'TBond' : 'SellBuy', deal.deal_number),
    isBuy,
    isinNumber: deal.isin_number,
    counterpartyId: deal.counterparty_id,
    faceValue: deal.face_value,
    couponRate,
    yieldRate: deal.yield,
    cleanPrice: deal.clean_price,
    accruedInterest: deal.accrued_interest,
    pricePer100: dirtyPrice,
    settlementValue: deal.settlement_amount,
    dealDate: deal.trade_date,
    valueDate: deal.value_date,
    maturityDate: deal.maturity_date,
    settlementInstruction: isBuy
      ? `We will transfer Rs. ${Number(deal.settlement_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} to your settlement account, value ${deal.value_date ? new Date(deal.value_date).toISOString().slice(0, 10) : ''}.`
      : `Please credit our settlement account for Rs. ${Number(deal.settlement_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, value ${deal.value_date ? new Date(deal.value_date).toISOString().slice(0, 10) : ''}.`
  });
}

// Buyback: 2 leg contents (Sale + Purchase) sharing one Ref, returned as an
// array so the caller can render them as 2 sheets/pages in one document.
async function getBuybackConfirmationContents(id) {
  const [rows] = await db.query(`SELECT * FROM buyback_deals WHERE id = ? LIMIT 1`, [id]);
  const deal = rows[0];
  if (!deal) {
    const err = new Error('Deal not found');
    err.status = 404;
    throw err;
  }

  // buyback_deals.coupon_rate/maturity_date are usually NULL (the deal record
  // doesn't duplicate static bond data) - fall back to isin_master, same
  // pattern as getGsecConfirmationContent above. Leg1/leg2 can reference
  // different ISINs in theory, so resolve both.
  const isinNumbers = [...new Set([deal.leg1_isin, deal.leg2_isin].filter(Boolean))];
  const isinMaster = {};
  if (isinNumbers.length) {
    const placeholders = isinNumbers.map(() => '?').join(',');
    const [isinRows] = await db.query(
      `SELECT isin_number, coupon_rate, maturity_date FROM isin_master WHERE isin_number IN (${placeholders})`,
      isinNumbers
    );
    isinRows.forEach((r) => { isinMaster[r.isin_number] = r; });
  }
  const couponRateFor = (isin) => deal.coupon_rate ?? isinMaster[isin]?.coupon_rate;
  const maturityDateFor = (isin) => deal.maturity_date ?? isinMaster[isin]?.maturity_date;

  const refNumber = buildRefNumber('SellBuy', deal.deal_number);

  const leg1 = await dealConfirmationService.buildGsecLegContent({
    refNumber,
    isBuy: false,
    isinNumber: deal.leg1_isin,
    counterpartyId: deal.leg1_counterparty,
    faceValue: deal.leg1_face_value,
    couponRate: couponRateFor(deal.leg1_isin),
    yieldRate: deal.leg1_yield_rate,
    cleanPrice: deal.leg1_clean_price,
    accruedInterest: deal.leg1_accrued_interest,
    pricePer100: deal.leg1_dirty_price,
    settlementValue: deal.leg1_settlement_amount,
    dealDate: deal.leg1_trade_date,
    valueDate: deal.leg1_value_date,
    maturityDate: maturityDateFor(deal.leg1_isin),
    rate: deal.leg1_interest_rate,
    settlementInstruction: `Please credit our Central Bank RTGS A/c for Rs. ${Number(deal.leg1_settlement_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${deal.leg1_value_date ? new Date(deal.leg1_value_date).toISOString().slice(0, 10) : ''}.`
  });

  const leg2 = await dealConfirmationService.buildGsecLegContent({
    refNumber,
    isBuy: true,
    isinNumber: deal.leg2_isin,
    counterpartyId: deal.leg2_counterparty,
    faceValue: deal.leg2_face_value ?? deal.leg1_face_value,
    couponRate: couponRateFor(deal.leg2_isin),
    yieldRate: deal.leg2_yield_rate,
    cleanPrice: deal.leg2_clean_price,
    accruedInterest: deal.leg2_accrued_interest,
    pricePer100: deal.leg2_dirty_price,
    settlementValue: deal.leg2_settlement_amount,
    dealDate: deal.leg2_trade_date,
    valueDate: deal.leg2_value_date,
    maturityDate: maturityDateFor(deal.leg2_isin),
    rate: deal.leg1_interest_rate,
    settlementInstruction: `We will send you a settlement instruction for Rs. ${Number(deal.leg2_settlement_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, value ${deal.leg2_value_date ? new Date(deal.leg2_value_date).toISOString().slice(0, 10) : ''}.`
  });

  leg1.title = `Sale Of Treasury Bond - ${deal.leg1_isin || ''}`;
  leg2.title = `Purchase Of Treasury Bond - ${deal.leg2_isin || ''}`;

  return [leg1, leg2];
}

async function getRepoConfirmationContent(id) {
  const [rows] = await db.query(`SELECT * FROM repo_deals WHERE id = ? LIMIT 1`, [id]);
  const deal = rows[0];
  if (!deal) {
    const err = new Error('Deal not found');
    err.status = 404;
    throw err;
  }

  // repo_deal_isins stores per-ISIN collateral (column is isin_number, not isin).
  // Match DealSlipViewModal / repoDealModel.getById so the letter lists the full
  // ISIN-wise allocation instead of falling back to the single header ISIN.
  let underlyingSecurities = [];
  try {
    const [isinRows] = await db.query(
      `SELECT isin_number, face_value
       FROM repo_deal_isins
       WHERE repo_deal_id = ?
       ORDER BY id`,
      [id]
    );
    underlyingSecurities = (isinRows || [])
      .filter((r) => r.isin_number)
      .map((r) => ({
        isin: r.isin_number,
        faceValue: r.face_value
      }));
  } catch (e) {
    // repo_deal_isins may not exist for legacy single-ISIN deals
    console.warn('repo_deal_isins lookup failed for confirmation:', e.message);
  }
  if (underlyingSecurities.length === 0 && deal.isin_number) {
    underlyingSecurities = [{
      isin: deal.isin_number,
      faceValue: deal.face_value ?? deal.face_value_as_per_counterparty
    }];
  }

  return dealConfirmationService.buildRepoContent({
    refNumber: buildRefNumber('Repo', deal.deal_number),
    dealType: deal.deal_type,
    counterpartyId: deal.counterparty_id,
    tradeDate: deal.trade_date,
    valueDate: deal.value_date,
    maturityDate: deal.maturity_date,
    principalAmount: deal.principal_amount,
    rate: deal.rate,
    maturityAmount: deal.maturity_amount,
    basis: deal.calculation_day_basis,
    underlyingSecurities
  });
}

function sendPdf(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  res.send(buffer);
}

async function sendDocx(res, filename, doc) {
  const buffer = await dealConfirmationService.Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
  res.send(buffer);
}

exports.getGsecConfirmationPdf = async (req, res) => {
  try {
    const content = await getGsecConfirmationContent(req.params.id);
    const buffer = await dealConfirmationService.streamPdf(dealConfirmationService.renderGsecLegPdf, content);
    sendPdf(res, content.refNumber, buffer);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

exports.getGsecConfirmationDocx = async (req, res) => {
  try {
    const content = await getGsecConfirmationContent(req.params.id);
    const doc = dealConfirmationService.buildGsecLegDocx(content);
    await sendDocx(res, content.refNumber, doc);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

exports.getBuybackConfirmationPdf = async (req, res) => {
  try {
    const contents = await getBuybackConfirmationContents(req.params.id);
    const buffer = await dealConfirmationService.streamPdf(dealConfirmationService.renderGsecLegPdf, contents);
    sendPdf(res, contents[0].refNumber, buffer);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

exports.getBuybackConfirmationDocx = async (req, res) => {
  try {
    const contents = await getBuybackConfirmationContents(req.params.id);
    const doc = buildTwoLegDocx(contents[0], contents[1]);
    await sendDocx(res, contents[0].refNumber, doc);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// Two sheets/pages in one Word document - leg1 (Sale) then leg2 (Purchase),
// separated by a page break, reusing buildGsecLegDocx's section children for
// each leg rather than duplicating the layout logic.
function buildTwoLegDocx(leg1, leg2) {
  const { Document, Paragraph, PageBreak } = require('docx');
  return new Document({
    sections: [
      dealConfirmationService.letterheadSection([
        ...dealConfirmationService.buildGsecLegDocxChildren(leg1),
        new Paragraph({ children: [new PageBreak()] }),
        ...dealConfirmationService.buildGsecLegDocxChildren(leg2)
      ])
    ]
  });
}

exports.getRepoConfirmationPdf = async (req, res) => {
  try {
    const content = await getRepoConfirmationContent(req.params.id);
    const buffer = await dealConfirmationService.streamPdf(dealConfirmationService.renderRepoPdf, content);
    sendPdf(res, content.refNumber, buffer);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

exports.getRepoConfirmationDocx = async (req, res) => {
  try {
    const content = await getRepoConfirmationContent(req.params.id);
    const doc = dealConfirmationService.buildRepoDocx(content);
    await sendDocx(res, content.refNumber, doc);
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};
