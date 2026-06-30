// Deal Confirmation document generation - shared helpers + PDF/Word renderers
// for GSEC Buy/Sell, Buyback (Sell-Buy/Buy-Sell), and Repo/Reverse Repo
// confirmations, modeled on the client's own sample confirmation PDFs.
//
// Counterparty resolution / company info reuse the same patterns already
// established in gsecLetterController.js, rather than duplicating that logic.

const db = require('../config/db');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType } = require('docx');

const COMPANY = {
  name: 'Sherwood Capital (Pvt) Ltd.',
  addressLines: ['No 100/1, 2nd Floor,', 'Elvitigala Mawatha,', 'Colombo 08.', 'Sri Lanka.'],
  telephone: '0115328131',
  contactPerson: 'Mr. Palihawadana'
};

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShortDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

// Same prefix-based counterparty resolution pattern as gsecLetterController.js,
// extended to also return address/telephone/contact fields for the
// confirmation's Buyer/Seller block.
async function fetchCounterpartyDetails(counterpartyId) {
  if (!counterpartyId) return null;
  const cpStr = String(counterpartyId);
  // gsec/buyback_deals store a prefixed id ('c12'/'i5'/'j3'); repo_deals
  // stores a bare numeric id with no type prefix and no separate type
  // column, so a leading digit (not i/c/j) means "try all three tables".
  const rawPrefix = cpStr[0]?.toLowerCase();
  const prefix = ['i', 'c', 'j'].includes(rawPrefix) ? rawPrefix : null;
  const numeric = parseInt(cpStr.replace(/[^0-9]/g, ''), 10);
  if (!numeric) return null;
  try {
    if (!prefix) {
      for (const p of ['c', 'i', 'j']) {
        const result = await fetchCounterpartyDetails(`${p}${numeric}`);
        if (result) return result;
      }
      return null;
    }
    if (prefix === 'i') {
      const [rows] = await db.query(
        `SELECT short_name, long_name, house_number, street_name, city, telephone, mobile
         FROM counterparty_master_individual WHERE id = ? LIMIT 1`, [numeric]
      );
      if (rows[0]) {
        const r = rows[0];
        return {
          name: r.long_name || r.short_name,
          addressLines: [r.house_number, r.street_name, r.city].filter(Boolean),
          telephone: r.telephone || r.mobile || '',
          contactPerson: r.long_name || r.short_name
        };
      }
    } else if (prefix === 'c') {
      const [rows] = await db.query(
        `SELECT short_name, long_name, address_line1, address_line2, city, phone_number, treasury_contact_person
         FROM counterparty_master_corporate WHERE id = ? LIMIT 1`, [numeric]
      );
      if (rows[0]) {
        const r = rows[0];
        return {
          name: r.long_name || r.short_name,
          addressLines: [r.address_line1, r.address_line2, r.city].filter(Boolean),
          telephone: r.phone_number || '',
          contactPerson: r.treasury_contact_person || r.long_name || r.short_name
        };
      }
    } else if (prefix === 'j') {
      const [rows] = await db.query(
        `SELECT short_name, long_name FROM counterparty_master_joint WHERE id = ? LIMIT 1`, [numeric]
      );
      if (rows[0]) {
        const r = rows[0];
        return { name: r.long_name || r.short_name, addressLines: [], telephone: '', contactPerson: r.long_name || r.short_name };
      }
    }
  } catch (err) {
    console.warn('[Deal Confirmation] Counterparty lookup failed:', err.message);
  }
  return null;
}

// ---------------------------------------------------------------------------
// GSEC Buy/Sell + Buyback leg confirmation content (matches the client's
// "SellBuy.../TBond..." sample PDFs: Buyer/Seller blocks, Deal Details,
// Settlement Details).
// ---------------------------------------------------------------------------
async function buildGsecLegContent({ refNumber, isBuy, isinNumber, counterpartyId, faceValue,
  couponRate, yieldRate, cleanPrice, accruedInterest, pricePer100, settlementValue,
  dealDate, valueDate, maturityDate, basis = 'Act/Act', rate, settlementInstruction }) {
  const counterparty = await fetchCounterpartyDetails(counterpartyId);
  const counterpartyBlock = counterparty || { name: `ID:${counterpartyId}`, addressLines: [], telephone: '', contactPerson: '' };

  const buyer = isBuy ? COMPANY : counterpartyBlock;
  const seller = isBuy ? counterpartyBlock : COMPANY;

  return {
    refNumber,
    title: `${isBuy ? 'Purchase' : 'Sale'} Of Treasury Bond${isinNumber ? ' - ' + isinNumber : ''}`,
    buyer,
    seller,
    dealDetails: [
      ['Instrument Type', 'Treasury Bonds'],
      ['Face Value', formatMoney(faceValue)],
      ['ISIN', isinNumber || ''],
      ['Coupon %', couponRate != null ? `${Number(couponRate).toFixed(4)} p.a.` : ''],
      ['Yield to Maturity %', yieldRate != null ? `${Number(yieldRate).toFixed(4)} p.a.` : ''],
      ['Clean Price', cleanPrice != null ? Number(cleanPrice).toFixed(4) : ''],
      ['Accrued Interest', accruedInterest != null ? Number(accruedInterest).toFixed(4) : ''],
      ['Price Per Rs.100/-', pricePer100 != null ? Number(pricePer100).toFixed(4) : ''],
      ['Settlement Value', formatMoney(settlementValue)],
      ['Deal Date', formatShortDate(dealDate)],
      ['Value Date', formatShortDate(valueDate)],
      ['Maturity Date', formatShortDate(maturityDate)],
      ['Basis', basis],
      ...(rate != null ? [['Rate', `${Number(rate).toFixed(2)}%`]] : [])
    ],
    settlementInstruction: settlementInstruction || ''
  };
}

// ---------------------------------------------------------------------------
// Repo / Reverse Repo confirmation content - Borrower/Lender blocks
// (role-swapped by deal type), Deal Details, Underlying Securities table,
// signature blocks. No "Security Substitution/Replenishment/Removal/
// Tradability Allowed" rows - confirmed dropped entirely per the client.
// ---------------------------------------------------------------------------
async function buildRepoContent({ refNumber, dealType, counterpartyId, tradeDate, valueDate,
  maturityDate, principalAmount, rate, maturityAmount, basis, underlyingSecurities }) {
  const counterparty = await fetchCounterpartyDetails(counterpartyId);
  const counterpartyBlock = counterparty || { name: `ID:${counterpartyId}`, addressLines: [], telephone: '', contactPerson: '' };

  // Repo: Sherwood is the Borrower (pledges securities, receives cash).
  // Reverse Repo: Sherwood is the Lender (provides cash, receives securities).
  const isReverse = String(dealType || '').toLowerCase().includes('reverse');
  const borrower = isReverse ? counterpartyBlock : COMPANY;
  const lender = isReverse ? COMPANY : counterpartyBlock;

  return {
    refNumber,
    title: `${dealType || 'Repo'} Agreement Confirmation`,
    borrower,
    lender,
    dealDetails: [
      ['Deal Type', dealType || ''],
      ['Trade Date', formatShortDate(tradeDate)],
      ['Value Date', formatShortDate(valueDate)],
      ['Maturity Date', formatShortDate(maturityDate)],
      ['Amount', formatMoney(principalAmount)],
      ['Rate', rate != null ? `${Number(rate).toFixed(2)}%` : ''],
      ['Total Amount at Maturity', formatMoney(maturityAmount)],
      ['Basis', basis != null ? String(basis) : 'Act/365']
    ],
    underlyingSecurities: underlyingSecurities || [],
    settlementProcess: isReverse
      ? `${COMPANY.name} will transfer the principal amount to the Borrower's settlement account on the value date above, ` +
        `against delivery of the underlying securities listed below, and will receive back the maturity proceeds and the ` +
        `securities on the maturity date.`
      : `${COMPANY.name} will deliver the underlying securities listed below as collateral and receive the principal amount ` +
        `on the value date above, repurchasing the securities for the maturity proceeds on the maturity date.`
  };
}

// ---------------------------------------------------------------------------
// PDF rendering (pdfkit)
// ---------------------------------------------------------------------------

// pdfkit tracks a single global doc.y cursor that auto-advances on every
// .text() call. Two side-by-side columns therefore can NOT alternate calls
// reading/writing doc.y (the second column's calls pick up wherever the
// first column's cursor ended up, producing interleaved/garbled text).
// This helper renders one column at explicit, manually-incremented y
// coordinates and returns the y position just past its last line, so the
// caller can lay out a second column at the same starting y independently.
function renderPartyColumn(doc, { label, party, x, y, width, lineHeight = 13 }) {
  let cursorY = y;
  doc.font('Helvetica-Bold').fontSize(10).text(label, x, cursorY, { underline: true, width });
  cursorY += lineHeight + 2;

  const lines = [party.name, ...(party.addressLines || []),
    `Telephone: ${party.telephone || ''}`,
    `Contact Person: ${party.contactPerson || ''}`];
  doc.font('Helvetica').fontSize(9.5);
  for (const line of lines) {
    doc.text(line || '', x, cursorY, { width });
    cursorY += lineHeight;
  }
  return cursorY;
}

// Same explicit-y / explicit-x reasoning as renderPartyColumn: pdfkit's
// `continued: true` does NOT reserve the declared `width` for the first
// chunk, it just wraps at that width - so a short label like "Coupon %"
// leaves the value sitting right next to it instead of in a clean aligned
// column. Writing label and value at fixed x positions guarantees every
// row's value starts at the same x, regardless of label length.
function renderLabelValueRows(doc, rows, { x, valueX, lineHeight = 13, labelWidth, valueWidth }) {
  let cursorY = doc.y;
  for (const [label, value] of rows) {
    doc.text(label, x, cursorY, { width: labelWidth });
    doc.text(value == null || value === '' ? '-' : String(value), valueX, cursorY, { width: valueWidth });
    cursorY += lineHeight;
  }
  doc.y = cursorY;
}

function renderGsecLegPdf(doc, content) {
  doc.font('Helvetica-Bold').fontSize(10).text(`Ref :- ${content.refNumber}`, { continued: false });
  doc.moveDown(0.3);
  doc.fontSize(13).text(content.title, { align: 'center', underline: true });
  doc.moveDown(1);

  const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;
  const startY = doc.y;

  const buyerEndY = renderPartyColumn(doc, {
    label: 'BUYER', party: content.buyer, x: doc.page.margins.left, y: startY, width: colWidth - 10
  });
  const sellerEndY = renderPartyColumn(doc, {
    label: 'SELLER', party: content.seller, x: doc.page.margins.left + colWidth, y: startY, width: colWidth - 10
  });

  doc.y = Math.max(buyerEndY, sellerEndY) + 16;
  doc.x = doc.page.margins.left;

  doc.font('Helvetica-Bold').fontSize(10).text('DEAL DETAILS', { underline: true });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9.5);
  renderLabelValueRows(doc, content.dealDetails, {
    x: doc.page.margins.left, valueX: doc.page.margins.left + 160, labelWidth: 150, valueWidth: 300
  });

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).text('SETTLEMENT DETAILS', { underline: true });
  doc.font('Helvetica').fontSize(9.5);
  doc.text(content.settlementInstruction || '');

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(9).text('This is a computer-generated document. No signature is required.');
}

function renderRepoPdf(doc, content) {
  doc.font('Helvetica-Bold').fontSize(10).text(`Ref :- ${content.refNumber}`);
  doc.moveDown(0.3);
  doc.fontSize(13).text(content.title, { align: 'center', underline: true });
  doc.moveDown(1);

  const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;
  const startY = doc.y;

  const borrowerEndY = renderPartyColumn(doc, {
    label: 'BORROWER', party: content.borrower, x: doc.page.margins.left, y: startY, width: colWidth - 10
  });
  const lenderEndY = renderPartyColumn(doc, {
    label: 'LENDER', party: content.lender, x: doc.page.margins.left + colWidth, y: startY, width: colWidth - 10
  });

  doc.y = Math.max(borrowerEndY, lenderEndY) + 16;
  doc.x = doc.page.margins.left;

  doc.font('Helvetica-Bold').fontSize(10).text('DEAL DETAILS', { underline: true });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9.5);
  renderLabelValueRows(doc, content.dealDetails, {
    x: doc.page.margins.left, valueX: doc.page.margins.left + 180, labelWidth: 170, valueWidth: 280
  });

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).text('UNDERLYING SECURITIES', { underline: true });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(9.5);
  const tableX = doc.page.margins.left;
  const valueX = tableX + 220;
  let tableY = doc.y;
  doc.text('ISIN', tableX, tableY, { width: 200 });
  doc.text('Face Value', valueX, tableY, { width: 200 });
  tableY += 14;
  doc.font('Helvetica').fontSize(9.5);
  (content.underlyingSecurities || []).forEach((s) => {
    doc.text(s.isin || '', tableX, tableY, { width: 200 });
    doc.text(formatMoney(s.faceValue), valueX, tableY, { width: 200 });
    tableY += 14;
  });
  doc.y = tableY;

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).text('SETTLEMENT PROCESS', { underline: true });
  doc.font('Helvetica').fontSize(9.5).text(content.settlementProcess);

  doc.moveDown(3);
  const sigY = doc.y;
  doc.fontSize(9.5);
  doc.text('_______________________', doc.page.margins.left, sigY);
  doc.text('Authorized Signatory', doc.page.margins.left, sigY + 14);
  doc.text('_______________________', doc.page.margins.left + colWidth, sigY);
  doc.text('Authorized Signatory', doc.page.margins.left + colWidth, sigY + 14);
}

function streamPdf(renderFn, contentOrContents) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contents = Array.isArray(contentOrContents) ? contentOrContents : [contentOrContents];
    contents.forEach((content, idx) => {
      if (idx > 0) doc.addPage();
      renderFn(doc, content);
    });
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Word rendering (docx)
// ---------------------------------------------------------------------------
function dealDetailsTable(rows) {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [3500, 5500],
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 3500, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })]
        }),
        new TableCell({
          width: { size: 5500, type: WidthType.DXA },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph(String(value))]
        })
      ]
    }))
  });
}

function partyParagraphs(heading, party) {
  return [
    new Paragraph({ children: [new TextRun({ text: heading, bold: true, underline: {} })] }),
    new Paragraph(party.name || ''),
    ...(party.addressLines || []).map((l) => new Paragraph(l)),
    new Paragraph(`Telephone: ${party.telephone || ''}`),
    new Paragraph(`Contact Person: ${party.contactPerson || ''}`)
  ];
}

// Returns the plain array of Paragraph/Table nodes for one leg, rather than
// a wrapped Document - docx's Document instances don't expose their section
// children back out (no public .sections getter), so building a multi-leg
// document (see dealConfirmationController.buildTwoLegDocx) requires reusing
// this node-array directly rather than trying to splice constructed
// Documents together.
function buildGsecLegDocxChildren(content) {
  return [
    new Paragraph({ children: [new TextRun({ text: `Ref :- ${content.refNumber}`, bold: true })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, children: [new TextRun({ text: content.title, underline: {} })] }),
    new Paragraph(' '),
    ...partyParagraphs('BUYER', content.buyer),
    new Paragraph(' '),
    ...partyParagraphs('SELLER', content.seller),
    new Paragraph(' '),
    new Paragraph({ children: [new TextRun({ text: 'DEAL DETAILS', bold: true, underline: {} })] }),
    dealDetailsTable(content.dealDetails),
    new Paragraph(' '),
    new Paragraph({ children: [new TextRun({ text: 'SETTLEMENT DETAILS', bold: true, underline: {} })] }),
    new Paragraph(content.settlementInstruction || ''),
    new Paragraph(' '),
    new Paragraph({ children: [new TextRun({ text: 'This is a computer-generated document. No signature is required.', bold: true })] })
  ];
}

function buildGsecLegDocx(content) {
  return new Document({
    sections: [{ children: buildGsecLegDocxChildren(content) }]
  });
}

function buildRepoDocx(content) {
  const secRows = (content.underlyingSecurities || []).map((s) => new TableRow({
    children: [
      new TableCell({ width: { size: 4500, type: WidthType.DXA }, children: [new Paragraph(s.isin || '')] }),
      new TableCell({ width: { size: 4500, type: WidthType.DXA }, children: [new Paragraph(formatMoney(s.faceValue))] })
    ]
  }));

  return new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: `Ref :- ${content.refNumber}`, bold: true })] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, children: [new TextRun({ text: content.title, underline: {} })] }),
        new Paragraph(' '),
        ...partyParagraphs('BORROWER', content.borrower),
        new Paragraph(' '),
        ...partyParagraphs('LENDER', content.lender),
        new Paragraph(' '),
        new Paragraph({ children: [new TextRun({ text: 'DEAL DETAILS', bold: true, underline: {} })] }),
        dealDetailsTable(content.dealDetails),
        new Paragraph(' '),
        new Paragraph({ children: [new TextRun({ text: 'UNDERLYING SECURITIES', bold: true, underline: {} })] }),
        new Table({
          width: { size: 9000, type: WidthType.DXA },
          columnWidths: [4500, 4500],
          rows: [
            new TableRow({ children: [
              new TableCell({ width: { size: 4500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'ISIN', bold: true })] })] }),
              new TableCell({ width: { size: 4500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: 'Face Value', bold: true })] })] })
            ] }),
            ...secRows
          ]
        }),
        new Paragraph(' '),
        new Paragraph({ children: [new TextRun({ text: 'SETTLEMENT PROCESS', bold: true, underline: {} })] }),
        new Paragraph(content.settlementProcess || ''),
        new Paragraph(' '),
        new Paragraph(' '),
        new Paragraph('_______________________                    _______________________'),
        new Paragraph('Authorized Signatory                                  Authorized Signatory')
      ]
    }]
  });
}

module.exports = {
  COMPANY,
  fetchCounterpartyDetails,
  buildGsecLegContent,
  buildRepoContent,
  renderGsecLegPdf,
  renderRepoPdf,
  streamPdf,
  buildGsecLegDocx,
  buildGsecLegDocxChildren,
  buildRepoDocx,
  Packer
};
