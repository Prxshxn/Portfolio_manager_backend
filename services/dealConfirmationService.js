// Deal Confirmation document generation - shared helpers + PDF/Word renderers
// for GSEC Buy/Sell, Buyback (Sell-Buy/Buy-Sell), and Repo/Reverse Repo
// confirmations, modeled on the client's own sample confirmation PDFs.
//
// Counterparty resolution / company info reuse the same patterns already
// established in gsecLetterController.js, rather than duplicating that logic.

const db = require('../config/db');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, Header, Footer,
  TextDirection, VerticalAlignTable, HeightRule, TableAnchorType,
  OverlapType, TableBorders, UnderlineType } = require('docx');

const COMPANY = {
  name: 'Sherwood Capital (Pvt) Ltd.',
  addressLines: ['No 100/1, 2nd Floor,', 'Elvitigala Mawatha,', 'Colombo 08.', 'Sri Lanka.'],
  telephone: '0115328131',
  contactPerson: 'Mr. Palihawadana'
};

// Matches the Sherwood Capital letterhead used on GSEC letters
// (gsecLetterController.js): vertical company name on the left margin,
// address/contact footer, and Ambeon branding strip.
const LETTERHEAD = {
  company: 'SHERWOOD CAPITAL (PRIVATE) LIMITED',
  regNo: 'Reg No. PV00241251',
  address: 'No; 100/1, 2nd floor, Elvitigala Mawatha, Colombo 08. Sri Lanka',
  phoneFax: 'T : 0115328133 | F : 0112680225',
  email: 'E: treasury@sherwood.lk',
  web: 'W: www.ambeongroup.com',
  colors: { navy: '#1c3f7c', orange: '#f5821f', text: '#222222' }
};

// A4 margins tuned for the left sidebar + footer letterhead (points).
const PDF_MARGINS = { top: 56, right: 50, bottom: 100, left: 100 };

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

/** Value date as DD.MM.YYYY for settlement instruction wording. */
function formatDotDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** Principal as "105,050,000/-" (whole rupees when possible). */
function formatRsPrincipal(value) {
  const n = Math.abs(Number(value));
  if (!Number.isFinite(n)) return '0/-';
  const whole = Math.abs(n - Math.round(n)) < 0.001;
  const formatted = whole
    ? Math.round(n).toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted}/-`;
}

/**
 * Client settlement wording for Repo / Reverse Repo letters.
 * Seylan = counterparty name contains "Seylan"; otherwise DVP/RVP ("OTHER") wording.
 * Returns value-date instruction + separate maturity-proceeds line (own heading).
 */
function buildRepoSettlementProcess({ isReverse, counterpartyName, principalAmount, valueDate }) {
  const isSeylan = String(counterpartyName || '').toLowerCase().includes('seylan');
  const amount = formatRsPrincipal(principalAmount);
  const dateStr = formatDotDate(valueDate);
  const accountSeylan =
    'Sherwood Capital (Pvt) Ltd account at Seylan Bank Millennium branch A/C No. 0860-13374197-001';
  const accountOther =
    'Sherwood Capital (Pvt) Ltd account at Seylan Bank Millennium branch a/c no.0860-13374197-001';

  // Reverse Repo: Sherwood lends → debit Sherwood on value date, credit at maturity.
  // Repo: Sherwood borrows → credit Sherwood on value date, debit at maturity.
  if (isReverse && isSeylan) {
    return {
      settlementProcess: `Please debit Rs. ${amount} to ${accountSeylan}, value ${dateStr}.`,
      maturityProceeds: 'At maturity, please credit the same Account.'
    };
  }
  if (isReverse && !isSeylan) {
    return {
      settlementProcess: `Please debit Rs. ${amount} to ${accountOther} on DVP/RVP basis, value ${dateStr}.`,
      maturityProceeds: 'At maturity, please credit the same Account.'
    };
  }
  if (!isReverse && isSeylan) {
    return {
      settlementProcess: `Please credit Rs. ${amount} to ${accountSeylan}, value ${dateStr}.`,
      maturityProceeds: 'At maturity, please debit the same Account.'
    };
  }
  return {
    settlementProcess: `Please credit Rs. ${amount} to ${accountOther} on DVP/RVP basis, value ${dateStr}.`,
    maturityProceeds: 'At the maturity, please debit the same Account.'
  };
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

  // Confirmation roles (from Sherwood's book):
  //   Reverse Repo = Sherwood lends cash  → Lender = Sherwood, Borrower = counterparty
  //   Repo         = Sherwood borrows cash → Borrower = Sherwood, Lender = counterparty
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
    ...buildRepoSettlementProcess({
      isReverse,
      counterpartyName: counterpartyBlock.name,
      principalAmount,
      valueDate
    })
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

// Bordered grid table - draws a stroked rectangle per row plus vertical
// column separators, so values line up in a visible table format rather
// than relying on whitespace alone. cellsFn(row) returns the text for each
// column; boldFirstCol bolds column 0 (used for label:value rows).
function renderGridTable(doc, rows, {
  x, colWidths, rowHeight = 18, fontSize = 9.5, boldFirstCol = false, headerRow = null,
  boldLastRow = false, doubleUnderlineLastValue = false
}) {
  let cursorY = doc.y;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

  const drawRow = (cells, isHeader, forceBold = false, doubleUnderlineValue = false) => {
    doc.rect(x, cursorY, totalWidth, rowHeight).stroke();
    let cx = x;
    for (let i = 0; i < colWidths.length - 1; i += 1) {
      cx += colWidths[i];
      doc.moveTo(cx, cursorY).lineTo(cx, cursorY + rowHeight).stroke();
    }
    cx = x;
    cells.forEach((cellText, i) => {
      const bold = isHeader || forceBold || (boldFirstCol && i === 0);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      const text = cellText == null || cellText === '' ? (isHeader ? '' : '-') : String(cellText);
      doc.text(text, cx + 6, cursorY + (rowHeight - fontSize) / 2 - 1, { width: colWidths[i] - 12 });
      // Client mark-up: double-underline the Face Value total (last column).
      if (doubleUnderlineValue && i === cells.length - 1) {
        const uy = cursorY + rowHeight - 4;
        doc.moveTo(cx + 6, uy).lineTo(cx + colWidths[i] - 6, uy).stroke();
        doc.moveTo(cx + 6, uy + 2.5).lineTo(cx + colWidths[i] - 6, uy + 2.5).stroke();
      }
      cx += colWidths[i];
    });
    cursorY += rowHeight;
  };

  if (headerRow) drawRow(headerRow, true);
  rows.forEach((r, idx) => {
    const isLast = idx === rows.length - 1;
    drawRow(r, false, boldLastRow && isLast, doubleUnderlineLastValue && isLast);
  });
  // Each cell's .text() call leaves doc.x wherever it last wrote, which is
  // NOT the table's left edge - any subsequent .text() call without an
  // explicit x (e.g. a heading or centered paragraph right after the table)
  // would silently inherit that stale x instead of starting at the margin.
  // Reset both cursor coordinates back to the table's origin column.
  doc.x = x;
  doc.y = cursorY + 8;
}

/** Stamp Sherwood letterhead onto the current PDFKit page (sidebar + footer). */
function drawLetterhead(doc) {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const { navy, orange, text } = LETTERHEAD.colors;

  // Vertical company name at top-left with a small left margin (upright, reads upward).
  // Company + reg no are drawn on one baseline (single line).
  doc.save();
  doc.font('Helvetica-Bold').fontSize(14);
  const nameW = doc.widthOfString(LETTERHEAD.company);
  doc.font('Helvetica').fontSize(8);
  const regW = doc.widthOfString(`  ${LETTERHEAD.regNo}`);
  // ~8mm from left page edge.
  doc.translate(22, 48 + nameW + regW);
  doc.rotate(-90);
  doc.fillColor(navy);
  doc.font('Helvetica-Bold').fontSize(14);
  doc.text(LETTERHEAD.company, 0, 0, { lineBreak: false });
  doc.font('Helvetica').fontSize(8);
  doc.text(`  ${LETTERHEAD.regNo}`, nameW, 1, { lineBreak: false });
  doc.restore();

  // Address / contact left; Ambeon strip centered (matches sample letter footer).
  let fy = pageH - 88;
  const left = 56;
  doc.fillColor(text);
  doc.font('Helvetica').fontSize(8);
  [
    LETTERHEAD.address,
    LETTERHEAD.phoneFax,
    LETTERHEAD.email,
    LETTERHEAD.web
  ].forEach((line) => {
    doc.text(line, left, fy, { lineBreak: false });
    fy += 11;
  });

  const ambeonY = pageH - 26;
  const parts = [
    { t: '● ', color: orange, font: 'Helvetica' },
    { t: 'AN ', color: text, font: 'Helvetica' },
    { t: 'AMBEON', color: navy, font: 'Helvetica-Bold' },
    { t: ' COMPANY', color: text, font: 'Helvetica' }
  ];
  const widths = parts.map((p) => {
    doc.font(p.font).fontSize(8);
    return doc.widthOfString(p.t);
  });
  let ax = (pageW - widths.reduce((a, b) => a + b, 0)) / 2;
  parts.forEach((p, i) => {
    doc.font(p.font).fontSize(8).fillColor(p.color);
    doc.text(p.t, ax, ambeonY, { lineBreak: false });
    ax += widths[i];
  });
  doc.fillColor('#000000');
}

/** ISIN / Face Value rows only (Total is rendered separately below the table). */
function securitiesAllocationRows(securities) {
  return (securities || []).map((s) => [s.isin || '', formatMoney(s.faceValue)]);
}

function securitiesFaceValueTotal(securities) {
  return (securities || []).reduce((sum, s) => sum + (Number(s.faceValue) || 0), 0);
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
  renderGridTable(doc, content.dealDetails, {
    x: doc.page.margins.left, colWidths: [160, 300], boldFirstCol: true
  });

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).text('SETTLEMENT DETAILS', { underline: true });
  doc.font('Helvetica').fontSize(9.5);
  doc.text(content.settlementInstruction || '');

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(9).text('This is a computer-generated document. No signature is required.');
}

function renderRepoPdf(doc, content) {
  doc.fillColor('#000000');
  doc.font('Helvetica-Bold').fontSize(10).text(`Ref :- ${content.refNumber}`);
  doc.moveDown(0.3);
  // Client: title must be black & bold (underlined).
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000')
    .text(content.title, { align: 'center', underline: true });
  doc.moveDown(1);

  const halfWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;
  const startY = doc.y;

  const borrowerEndY = renderPartyColumn(doc, {
    label: 'BORROWER', party: content.borrower, x: doc.page.margins.left, y: startY, width: halfWidth - 10
  });
  const lenderEndY = renderPartyColumn(doc, {
    label: 'LENDER', party: content.lender, x: doc.page.margins.left + halfWidth, y: startY, width: halfWidth - 10
  });

  doc.y = Math.max(borrowerEndY, lenderEndY) + 16;
  doc.x = doc.page.margins.left;

  doc.font('Helvetica-Bold').fontSize(10).text('DEAL DETAILS', { underline: true });
  doc.moveDown(0.3);
  renderGridTable(doc, content.dealDetails, {
    x: doc.page.margins.left, colWidths: [180, 280], boldFirstCol: true
  });

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).text('UNDERLYING SECURITIES', { underline: true });
  doc.moveDown(0.3);
  const secColWidths = [230, 230];
  const secX = doc.page.margins.left;
  renderGridTable(
    doc,
    securitiesAllocationRows(content.underlyingSecurities),
    { x: secX, colWidths: secColWidths, headerRow: ['ISIN', 'Face Value'] }
  );

  // Total shown separately below the table (not as a table row).
  const totalAmount = formatMoney(securitiesFaceValueTotal(content.underlyingSecurities));
  const totalY = doc.y + 2;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000000');
  doc.text('Total', secX + 6, totalY, { width: secColWidths[0] - 12 });
  doc.text(totalAmount, secX + secColWidths[0] + 6, totalY, { width: secColWidths[1] - 12 });
  const underlineY = totalY + 12;
  const valueLeft = secX + secColWidths[0] + 6;
  const valueRight = secX + secColWidths[0] + secColWidths[1] - 6;
  doc.moveTo(valueLeft, underlineY).lineTo(valueRight, underlineY).stroke();
  doc.moveTo(valueLeft, underlineY + 2.5).lineTo(valueRight, underlineY + 2.5).stroke();
  doc.y = underlineY + 14;
  doc.x = secX;

  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).text('SETTLEMENT PROCESS', doc.page.margins.left, doc.y, { underline: true, width: contentWidth });
  doc.font('Helvetica').fontSize(9.5).text(content.settlementProcess || '', doc.page.margins.left, doc.y, {
    align: 'left',
    width: contentWidth
  });

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(10).text('MATURITY PROCEEDS', doc.page.margins.left, doc.y, { underline: true, width: contentWidth });
  doc.font('Helvetica').fontSize(9.5).text(content.maturityProceeds || '', doc.page.margins.left, doc.y, {
    align: 'left',
    width: contentWidth
  });

  // Signature blocks lower on the page: one flush left, one flush right.
  doc.moveDown(5);
  const sigY = Math.max(doc.y, doc.page.height - doc.page.margins.bottom - 70);
  const sigLine = '_______________________';
  const sigLabel = 'Authorized Signatory';
  doc.font('Helvetica').fontSize(9.5).fillColor('#000000');
  const lineW = doc.widthOfString(sigLine);
  const leftX = doc.page.margins.left;
  const rightX = doc.page.width - doc.page.margins.right - lineW;
  doc.text(sigLine, leftX, sigY);
  doc.text(sigLabel, leftX, sigY + 14);
  doc.text(sigLine, rightX, sigY);
  doc.text(sigLabel, rightX, sigY + 14);
}

function streamPdf(renderFn, contentOrContents) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: PDF_MARGINS, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contents = Array.isArray(contentOrContents) ? contentOrContents : [contentOrContents];
    contents.forEach((content, idx) => {
      if (idx > 0) doc.addPage();
      renderFn(doc, content);
    });

    // Stamp letterhead on every page after content is laid out so multi-page
    // confirmations (e.g. two-leg buyback) all carry the same branding.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawLetterhead(doc);
    }
    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Word rendering (docx)
// ---------------------------------------------------------------------------

/**
 * Shared header/footer letterhead for Word confirmations (repo + buyback).
 * Mirrors the PDF layout: vertical company name down the left page margin,
 * address/contact block bottom-left, Ambeon strip centered at the very bottom.
 */
function letterheadSection(children) {
  const navy = '1C3F7C';
  const orange = 'F5821F';
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  // Vertical letterhead: one continuous line (company + reg no), with padding
  // inside the strip so text is not flush against the border / page edge.
  const sidebarTable = new Table({
    width: { size: 700, type: WidthType.DXA },
    columnWidths: [700],
    borders: TableBorders.NONE,
    float: {
      horizontalAnchor: TableAnchorType.PAGE,
      verticalAnchor: TableAnchorType.PAGE,
      // Small margin from the left page edge (~5mm).
      absoluteHorizontalPosition: 280,
      // Align with the top of the body (Ref / title), not mid-page.
      absoluteVerticalPosition: 200,
      overlap: OverlapType.OVERLAP,
      leftFromText: 0,
      rightFromText: 0,
      topFromText: 0,
      bottomFromText: 0
    },
    rows: [
      new TableRow({
        // Tall enough that company + reg stay on a single vertical line.
        height: { value: 9200, rule: HeightRule.EXACT },
        children: [
          new TableCell({
            width: { size: 700, type: WidthType.DXA },
            borders: noBorders,
            // Padding so glyphs are not flush against the cell border.
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            textDirection: TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT,
            // TOP (not CENTER) so the strip starts at the Ref header line.
            verticalAlign: VerticalAlignTable.TOP,
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0, line: 276 },
                wordWrap: false,
                children: [
                  new TextRun({
                    text: `${LETTERHEAD.company}  ${LETTERHEAD.regNo}`,
                    bold: true,
                    color: navy,
                    size: 24,
                    font: 'Arial'
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  });

  return {
    properties: {
      page: {
        // Match PDF margins: room for left sidebar + footer address block.
        // Twips (1440 = 1"). left ~0.85", bottom ~1.1", top/right ~0.7".
        margin: {
          top: 1000,
          right: 1000,
          bottom: 1600,
          left: 1220,
          header: 200,
          footer: 400
        }
      }
    },
    headers: {
      // Empty body header; sidebar is a floating table so it does not push
      // content down the way a normal header line would.
      default: new Header({
        children: [sidebarTable, new Paragraph({ children: [] })]
      })
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 0, after: 0, line: 240 },
            children: [new TextRun({ text: LETTERHEAD.address, size: 16, font: 'Arial', color: '222222' })]
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 0, after: 0, line: 240 },
            children: [new TextRun({ text: LETTERHEAD.phoneFax, size: 16, font: 'Arial', color: '222222' })]
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 0, after: 0, line: 240 },
            children: [new TextRun({ text: LETTERHEAD.email, size: 16, font: 'Arial', color: '222222' })]
          }),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 0, after: 60, line: 240 },
            children: [new TextRun({ text: LETTERHEAD.web, size: 16, font: 'Arial', color: '222222' })]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 0 },
            children: [
              new TextRun({ text: '● ', color: orange, size: 16, font: 'Arial' }),
              new TextRun({ text: 'AN ', size: 16, font: 'Arial', color: '222222' }),
              new TextRun({ text: 'AMBEON', bold: true, color: navy, size: 16, font: 'Arial' }),
              new TextRun({ text: ' COMPANY', size: 16, font: 'Arial', color: '222222' })
            ]
          })
        ]
      })
    },
    children
  };
}

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

/** Two party blocks opposite each other (left | right) for Word letters. */
function partySideBySideTable(leftHeading, leftParty, rightHeading, rightParty) {
  const noBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  };
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [4500, 4500],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 4500, type: WidthType.DXA },
            borders: noBorders,
            margins: { top: 0, bottom: 80, left: 0, right: 120 },
            children: partyParagraphs(leftHeading, leftParty || {})
          }),
          new TableCell({
            width: { size: 4500, type: WidthType.DXA },
            borders: noBorders,
            margins: { top: 0, bottom: 80, left: 120, right: 0 },
            children: partyParagraphs(rightHeading, rightParty || {})
          })
        ]
      })
    ]
  });
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
    partySideBySideTable('BUYER', content.buyer, 'SELLER', content.seller),
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
    sections: [letterheadSection(buildGsecLegDocxChildren(content))]
  });
}

function buildRepoDocx(content) {
  const noBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  };
  const allocationRows = securitiesAllocationRows(content.underlyingSecurities);
  const secRows = allocationRows.map((cells) => new TableRow({
    children: cells.map((cellText) => new TableCell({
      width: { size: 4500, type: WidthType.DXA },
      children: [new Paragraph({
        children: [new TextRun({ text: String(cellText ?? ''), color: '000000' })]
      })]
    }))
  }));
  const totalAmount = formatMoney(securitiesFaceValueTotal(content.underlyingSecurities));

  return new Document({
    sections: [letterheadSection([
      new Paragraph({ children: [new TextRun({ text: `Ref :- ${content.refNumber}`, bold: true, color: '000000' })] }),
      // Client: title black & bold (avoid Heading styles that can apply theme blue).
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: content.title,
          bold: true,
          color: '000000',
          size: 26,
          underline: { type: UnderlineType.SINGLE }
        })]
      }),
      new Paragraph(' '),
      partySideBySideTable('BORROWER', content.borrower, 'LENDER', content.lender),
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
      // Total outside the securities table, aligned under ISIN / Face Value columns.
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        columnWidths: [4500, 4500],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 4500, type: WidthType.DXA },
                borders: noBorders,
                children: [new Paragraph({
                  spacing: { before: 120, after: 60 },
                  children: [new TextRun({ text: 'Total', bold: true, color: '000000' })]
                })]
              }),
              new TableCell({
                width: { size: 4500, type: WidthType.DXA },
                borders: noBorders,
                children: [new Paragraph({
                  spacing: { before: 120, after: 60 },
                  children: [new TextRun({
                    text: totalAmount,
                    bold: true,
                    color: '000000',
                    underline: { type: UnderlineType.DOUBLE }
                  })]
                })]
              })
            ]
          })
        ]
      }),
      new Paragraph(' '),
      new Paragraph({ children: [new TextRun({ text: 'SETTLEMENT PROCESS', bold: true, underline: {} })] }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 200 },
        children: [new TextRun(content.settlementProcess || '')]
      }),
      new Paragraph({ children: [new TextRun({ text: 'MATURITY PROCEEDS', bold: true, underline: {} })] }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 200 },
        children: [new TextRun(content.maturityProceeds || '')]
      }),
      new Paragraph(' '),
      new Paragraph(' '),
      new Paragraph(' '),
      new Paragraph(' '),
      new Table({
        width: { size: 9000, type: WidthType.DXA },
        columnWidths: [4500, 4500],
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 4500, type: WidthType.DXA },
                borders: noBorders,
                children: [
                  new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun('_______________________')] }),
                  new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun('Authorized Signatory')] })
                ]
              }),
              new TableCell({
                width: { size: 4500, type: WidthType.DXA },
                borders: noBorders,
                children: [
                  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('_______________________')] }),
                  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('Authorized Signatory')] })
                ]
              })
            ]
          })
        ]
      })
    ])]
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
  letterheadSection,
  Packer
};
