// GSEC Letter Generator
// Produces dynamic instruction letters (DVP / DVF / RVP / RVF) for a GSEC deal.
// The letter recipient + body change with transaction_type and fund_movement.

const db = require('../config/db');

// -------- Company (issuer of the letter) --------
// Sherwood Capital details are static for the letter header/footer.
const COMPANY = {
  name: 'Sherwood Capital (Pvt) Ltd',
  bankName: 'Seylan Bank',
  bankBranch: 'Millennium branch',
  bankAccountNumber: '0860-13374197-001',
};

// Minimal address book for known banks. Falls back to a generic recipient
// block when an exact match is not found.
const BANK_ADDRESSES = {
  'seylan bank plc': {
    attn: 'Attn:  Darshi / Niromi',
    title: 'Manager Treasury Settlements',
    lines: ['Seylan Bank PLC,', 'Ceylinco Seylan Towers,', 'No 90, Galle Road,', 'Colombo 03.'],
  },
  'seylan bank': {
    attn: 'Attn:  Darshi / Niromi',
    title: 'Manager Treasury Settlements',
    lines: ['Seylan Bank PLC,', 'Ceylinco Seylan Towers,', 'No 90, Galle Road,', 'Colombo 03.'],
  },
  'cargills bank': {
    title: 'Head of Treasury,',
    lines: ['Cargills Bank.', 'No.696, Galle Road', 'Colombo-03'],
  },
  'cargills bank plc': {
    title: 'Head of Treasury,',
    lines: ['Cargills Bank.', 'No.696, Galle Road', 'Colombo-03'],
  },
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLongDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatShortDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Build the reference number e.g. SCPL/SECURITIES/15/12/2025/001
function buildReferenceNumber(deal) {
  const d = deal.value_date ? new Date(deal.value_date) : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  // Use last 3 digits of the deal_number tail as sequence, or fall back to id
  let seq = '001';
  const dealNum = String(deal.deal_number || '');
  const tail = dealNum.split('/').pop();
  if (tail && /\d+/.test(tail)) {
    seq = tail.match(/\d+/)[0].padStart(3, '0').slice(-3);
  } else if (deal.id) {
    seq = String(deal.id).padStart(3, '0').slice(-3);
  }
  return `SCPL/SECURITIES/${dd}/${mm}/${yyyy}/${seq}`;
}

async function fetchCounterparty(counterpartyId) {
  if (!counterpartyId) return null;
  const cpStr = String(counterpartyId);
  const prefix = cpStr[0]?.toLowerCase();
  const numeric = parseInt(cpStr.replace(/[^0-9]/g, ''), 10);
  if (!numeric) return null;
  try {
    if (prefix === 'i') {
      const [rows] = await db.query(
        `SELECT id, short_name, long_name, id_number, id_type FROM counterparty_master_individual WHERE id = ? LIMIT 1`,
        [numeric]
      );
      if (rows[0]) return { ...rows[0], type: 'individual' };
    } else if (prefix === 'c') {
      const [rows] = await db.query(
        `SELECT id, short_name, long_name FROM counterparty_master_corporate WHERE id = ? LIMIT 1`,
        [numeric]
      );
      if (rows[0]) return { ...rows[0], type: 'corporate' };
    } else if (prefix === 'j') {
      const [rows] = await db.query(
        `SELECT id, short_name, long_name FROM counterparty_master_joint WHERE id = ? LIMIT 1`,
        [numeric]
      );
      if (rows[0]) return { ...rows[0], type: 'joint' };
    }
  } catch (err) {
    console.warn('[GSEC Letter] Counterparty lookup failed:', err.message);
  }
  return null;
}

async function fetchSettlementBank(settlementMode) {
  if (!settlementMode) return null;
  try {
    const [rows] = await db.query(
      `SELECT bank_name, bank_branch, bank_account_number, bank_payment_code
       FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1`,
      [settlementMode]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[GSEC Letter] Settlement bank lookup failed:', err.message);
    return null;
  }
}

function pickBankAddress(bankName) {
  if (!bankName) return null;
  const key = String(bankName).trim().toLowerCase();
  if (BANK_ADDRESSES[key]) return BANK_ADDRESSES[key];
  // Try partial match
  for (const k of Object.keys(BANK_ADDRESSES)) {
    if (key.includes(k) || k.includes(key)) return BANK_ADDRESSES[k];
  }
  return null;
}

function buildRecipientBlock(bankName, fundMovementIsYes, transactionType) {
  // Without funds + Buy uses a different recipient style if the bank is known
  const known = pickBankAddress(bankName);
  if (known) {
    const lines = [];
    if (known.attn) lines.push(known.attn);
    if (known.title) lines.push(known.title);
    lines.push(...known.lines);
    return lines;
  }
  // Generic fallback when bank not in address book
  const cleanedBank = bankName ? String(bankName).trim() : 'Counterparty Bank';
  const fallback = ['Manager Treasury Settlements', `${cleanedBank},`];
  return fallback;
}

async function getDealById(id) {
  const [rows] = await db.query(
    `SELECT g.*, im.coupon_rate
     FROM gsec g
     LEFT JOIN isin_master im
       ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Resolve the 4 scenarios + dynamic data for the letter.
 * Scenarios:
 *  - Sell + yes  -> Deliver / DVP basis (credit funds)
 *  - Sell + no   -> Deliver / DVF basis (no funds)
 *  - Buy  + yes  -> Receive / RVP basis (debit funds)
 *  - Buy  + no   -> Receive / RVF basis (no funds)
 */
async function buildLetterContext(dealId) {
  const deal = await getDealById(dealId);
  if (!deal) {
    const err = new Error('Deal not found');
    err.status = 404;
    throw err;
  }

  const txType = String(deal.transaction_type || '').toLowerCase();
  const fundMovementIsYes = String(deal.fund_movement || 'no').toLowerCase() === 'yes';
  const isBuy = txType === 'buy';
  const isSell = txType === 'sell';

  let action = isBuy ? 'Receive' : 'Deliver';
  let basis = isBuy
    ? (fundMovementIsYes ? 'RVP' : 'RVF')
    : (fundMovementIsYes ? 'DVP' : 'DVF');

  const counterparty = await fetchCounterparty(deal.counterparty_id);
  const counterpartyDisplay = counterparty
    ? (counterparty.long_name || counterparty.short_name || `ID:${deal.counterparty_id}`) +
      (counterparty.type === 'individual' && counterparty.id_number ? ` (${counterparty.id_number})` : '')
    : (deal.counterparty_id ? `ID:${deal.counterparty_id}` : 'Counterparty');

  const settlementBank = await fetchSettlementBank(deal.settlement_mode);
  const recipientBankName = settlementBank?.bank_name || COMPANY.bankName;
  const recipientLines = buildRecipientBlock(recipientBankName, fundMovementIsYes, txType);

  const referenceNumber = buildReferenceNumber(deal);
  const letterDateLong = formatLongDate(new Date());
  const valueDateLong = formatLongDate(deal.value_date);
  const valueDateShort = formatShortDate(deal.value_date);

  const subjectTitle = (() => {
    if (isSell && fundMovementIsYes) return 'Sale of Bond';
    if (isSell && !fundMovementIsYes) return 'Sale - Securities transfer without fund movement';
    if (isBuy && fundMovementIsYes) return 'Purchase of Bond';
    return 'Purchase - Securities transfer without fund movement';
  })();

  const settlementAmount = Number(deal.settlement_amount || 0);
  const faceValue = Number(deal.face_value || 0);

  // Determine the funds line (only when fundMovement = yes)
  let fundsParagraph = null;
  if (fundMovementIsYes) {
    if (isSell) {
      fundsParagraph =
        `Please be good enough to <b>credit</b> <b>funds</b> to ${COMPANY.name} current account at ` +
        `${COMPANY.bankName} ${COMPANY.bankBranch} a/c no. <b>${COMPANY.bankAccountNumber}</b>.`;
    } else {
      fundsParagraph =
        `Please be good enough to <b>debit</b> <b>funds</b> from ${COMPANY.name} current account at ` +
        `<b>${COMPANY.bankName}</b> <b>${COMPANY.bankBranch}</b> a/c no. <b>${COMPANY.bankAccountNumber}</b>, ` +
        `Value <b>${valueDateShort}</b>.`;
    }
  }

  // Build the counterparty / amount sentence
  // Sell + yes : "To <cp> on DVP basis for Rs. X"
  // Sell + no  : "To <cp> on DVF basis ."
  // Buy  + yes : "From <cp> on RVP basis for Rs. X"
  // Buy  + no  : "From <cp> on RVF basis ,"
  const directionWord = isBuy ? 'From' : 'To';
  const amountClause = fundMovementIsYes
    ? ` for <b>Rs. ${formatMoney(settlementAmount)}</b>`
    : '';
  const counterpartySentence =
    `${directionWord} <b>${escapeHtml(counterpartyDisplay)}</b> on <b>${basis}</b> basis${amountClause}${fundMovementIsYes ? '' : ' .'}`;

  // Value-date line (printed for "without funds" letters)
  const valueDateLine = isBuy
    ? `Value date ${valueDateLong}`
    : `Value ${valueDateLong}`;

  return {
    deal: {
      id: deal.id,
      deal_number: deal.deal_number,
      isin_number: deal.isin_number,
      face_value: faceValue,
      settlement_amount: settlementAmount,
      transaction_type: deal.transaction_type,
      value_date: deal.value_date,
      maturity_date: deal.maturity_date,
      fund_movement: fundMovementIsYes ? 'yes' : 'no',
    },
    scenario: {
      action,
      basis,
      isBuy,
      isSell,
      fundMovementIsYes,
      subjectTitle,
    },
    counterpartyDisplay,
    recipientLines,
    referenceNumber,
    letterDateLong,
    valueDateLong,
    valueDateShort,
    counterpartySentence,
    fundsParagraph,
    valueDateLine,
    company: COMPANY,
  };
}

function renderLetterHtml(ctx) {
  const { deal, scenario, recipientLines, referenceNumber, letterDateLong,
    counterpartySentence, fundsParagraph, valueDateLine, company } = ctx;

  const recipientHtml = recipientLines.map(l => `<div>${escapeHtml(l)}</div>`).join('\n');
  const subjectLine = scenario.fundMovementIsYes
    ? 'Transfer of Funds &amp; Securities o/a of ' + escapeHtml(company.name)
    : 'Transfer of Securities o/a of ' + escapeHtml(company.name);

  const requestVerbLine = scenario.isBuy
    ? 'Please be good enough to <b>Receive</b> the following securities as per details.'
    : 'Please be good enough to <b>Deliver</b> the following securities as per details.';

  const fundsBlock = fundsParagraph ? `<p>${fundsParagraph}</p>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>GSEC Letter - ${escapeHtml(deal.deal_number)}</title>
<style>
  @page { size: A4; margin: 25mm 20mm; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 13px;
    color: #000;
    line-height: 1.55;
    margin: 0;
    padding: 24px;
    background: #fff;
  }
  .letter { max-width: 720px; margin: 0 auto; }
  .header-right { text-align: left; }
  .header-right .date,
  .header-right .ref {
    margin: 0;
  }
  .recipient { margin-top: 24px; }
  .recipient .attn { font-weight: bold; }
  h2.subject {
    font-size: 14px;
    margin: 28px 0 12px;
    text-align: center;
    text-decoration: underline;
  }
  table.securities {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
  }
  table.securities th, table.securities td {
    border: 1px solid #000;
    padding: 6px 10px;
    text-align: left;
  }
  table.securities th { background: #f3f3f3; }
  .value-date { margin-top: 18px; font-weight: bold; }
  .signatures {
    margin-top: 48px;
    display: flex;
    justify-content: space-between;
  }
  .signatures .slot {
    width: 45%;
    border-top: 1px solid #000;
    padding-top: 4px;
    text-align: center;
    font-size: 12px;
  }
  .actions {
    position: sticky;
    top: 0;
    background: #fff;
    padding: 8px 0 12px;
    border-bottom: 1px solid #eee;
    margin-bottom: 12px;
    display: flex;
    gap: 8px;
  }
  .actions button {
    padding: 6px 14px;
    cursor: pointer;
    border: 1px solid #444;
    background: #fff;
    border-radius: 4px;
    font-size: 13px;
  }
  .actions button.primary {
    background: #1a73e8;
    color: #fff;
    border-color: #1a73e8;
  }
  @media print {
    .actions { display: none; }
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="actions">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>
  <div class="letter">
    <div class="header-right">
      <div class="date">${escapeHtml(letterDateLong)}</div>
      <div class="ref">${escapeHtml(referenceNumber)}</div>
    </div>

    <div class="recipient">
      ${recipientHtml}
    </div>

    <p>Dear Sir,</p>

    <h2 class="subject">${subjectLine}</h2>

    <p>${requestVerbLine}</p>

    <p>${counterpartySentence}</p>

    <table class="securities">
      <thead>
        <tr>
          <th>ISIN Code</th>
          <th>Face Value (Rs.)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(deal.isin_number || '')}</td>
          <td>${formatMoney(deal.face_value)}</td>
        </tr>
      </tbody>
    </table>

    ${fundsBlock}

    <p class="value-date">${escapeHtml(valueDateLine)}</p>

    <p>Yours faithfully,</p>
    <p>For ${escapeHtml(company.name)}</p>

    <div class="signatures">
      <div class="slot">Authorized Signatory</div>
      <div class="slot">Authorized Signatory</div>
    </div>
  </div>
</body>
</html>`;
}

exports.getLetterData = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Deal id required' });
    const ctx = await buildLetterContext(id);
    res.json({ success: true, data: ctx });
  } catch (err) {
    const status = err.status || 500;
    console.error('[GSEC Letter] getLetterData error:', err);
    res.status(status).json({ success: false, error: err.message || 'Failed to generate letter data' });
  }
};

exports.getLetterHtml = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).send('Deal id required');
    const ctx = await buildLetterContext(id);
    const html = renderLetterHtml(ctx);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    const status = err.status || 500;
    console.error('[GSEC Letter] getLetterHtml error:', err);
    res.status(status).send(`<pre>${escapeHtml(err.message || 'Failed to render letter')}</pre>`);
  }
};
