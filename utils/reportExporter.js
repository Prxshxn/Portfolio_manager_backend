const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { parseISO, format } = require('date-fns');

function formatDate(val) {
  if (!val) return '';
  try {
    const dateObj = typeof val === 'string' ? parseISO(val) : val;
    return format(dateObj, 'dd-MMM-yyyy');
  } catch {
    return String(val).split('T')[0];
  }
}

const EXPORT_COLUMNS = [
  { key: 'product_type', label: 'Product Type' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'custodian', label: 'Custodian' },
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'isin', label: 'ISIN' },
  { key: 'coupon_interest', label: 'Coupon Interest' },
  { key: 'clean_price', label: 'Clean Price' },
  { key: 'dirty_price', label: 'Dirty Price' },
  { key: 'nvp', label: 'NVP' },
  { key: 'yield', label: 'Yield' },
  { key: 'dtm', label: 'DTM' },
  { key: 'balance', label: 'Balance' },
  { key: 'available_balance', label: 'Available Balance' },
  { key: 'wap', label: 'WAP' },
  { key: 'repo_collateral', label: 'Repo Collateral' },
  { key: 'sell_back', label: 'Sell Back' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'transaction_type', label: 'Transaction Type' }
];

// Columns for Portfolio report exports – mirror the on-screen Portfolio report
const PORTFOLIO_EXPORT_COLUMNS = [
  { key: 'product_type', label: 'Product Type' },
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'trade_date', label: 'Trade Date' },
  { key: 'isin', label: 'ISIN' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'transaction_type', label: 'Transaction Type' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'clean_price', label: 'Clean Price' },
  { key: 'dirty_price', label: 'Dirty Price' },
  { key: 'settlement_amount', label: 'Settlement Amount' },
  { key: 'maturity_amount', label: 'Maturity Amount' },
  { key: 'amount', label: 'Amount' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'status', label: 'Status' },
  { key: 'currency', label: 'Currency' }
];

// Repo + Reverse Repo report export columns
const REPO_EXPORT_COLUMNS = [
  { key: 'deal_type', label: 'Deal Type' },
  { key: 'counterparty', label: 'Counterparty' },
  { key: 'settlement_mode', label: 'Settlement Mode' },
  { key: 'trade_date', label: 'Trade Date' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'principal_amount', label: 'Principal Amount' },
  { key: 'rate', label: 'Rate (%)' },
  { key: 'tenor', label: 'Tenor (Days)' },
  { key: 'interest_amount', label: 'Interest Amount' },
  { key: 'maturity_amount', label: 'Maturity Amount' },
  { key: 'isin', label: 'ISIN number' },
  { key: 'face_value_as_per_counterparty', label: 'Face value as per counterparty' }
];

/** Parse numbers that may include thousand separators (e.g. API-formatted strings). */
function parseLocaleNumber(val) {
  if (val === undefined || val === null || val === '') return NaN;
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  const s = String(val).trim().replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function formatNumber4(val) {
  if (val === undefined || val === null || val === '') return '';
  const n = typeof val === 'number' ? val : parseLocaleNumber(val);
  if (isNaN(n)) return val !== undefined && val !== null ? String(val) : '';
  const truncated = Math.trunc(n * 10000) / 10000;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  }).format(truncated);
}

function formatNumber2(val) {
  if (val === undefined || val === null || val === '') return '';
  const n = parseLocaleNumber(val);
  if (isNaN(n)) return val;
  // Truncate (not round) to 2 decimals
  const truncated = Math.trunc(n * 100) / 100;
  // Format with comma separators and exactly 2 decimal places
  return new Intl.NumberFormat('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(truncated);
}

function toExcelNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const s = String(val).trim();
  if (!s) return null;
  const normalized = s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function preprocessExportData(data) {
  // Fallback WAP per ISIN (comma-safe) when row.wap is missing
  const isinMap = {};
  data.forEach(row => {
    const isin = row.isin;
    const fv = parseLocaleNumber(row.face_value);
    const cp = parseLocaleNumber(row.clean_price);
    const fvNum = isNaN(fv) ? 0 : fv;
    const cpNum = isNaN(cp) ? 0 : cp;
    if (!isinMap[isin]) {
      isinMap[isin] = { sumFV: 0, sumFVCP: 0 };
    }
    isinMap[isin].sumFV += fvNum;
    isinMap[isin].sumFVCP += fvNum * cpNum;
  });

  return data.map(row => {
    const mapped = {};
    EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (col.key === 'value_date' || col.key === 'maturity_date') {
        val = formatDate(val);
      }
      // 4 decimal places (prices / rates as returned by GSEC report API)
      if ([
        'coupon_interest',
        'yield',
        'balance',
        'available_balance',
        'clean_price',
        'dirty_price',
        'nvp',
        'repo_collateral'
      ].includes(col.key)) {
        val = formatNumber4(val);
      }
      // Currency-style 2 decimals
      if (col.key === 'face_value' || col.key === 'sell_back') {
        val = formatNumber2(val);
      }
      // DTM: integer days (handle locale-formatted integers)
      if (col.key === 'dtm') {
        const n = parseLocaleNumber(val);
        val = isNaN(n) ? val : Math.trunc(n).toString();
      }
      // Prefer API WAP (already ISIN-weighted); fallback to recomputed map
      if (col.key === 'wap') {
        const fromApi = parseLocaleNumber(row.wap);
        if (!isNaN(fromApi) && row.wap !== undefined && row.wap !== null && row.wap !== '') {
          val = formatNumber4(fromApi);
        } else {
          const m = isinMap[row.isin];
          const wapFallback = m && m.sumFV ? m.sumFVCP / m.sumFV : 0;
          val = formatNumber4(wapFallback);
        }
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

// Pre-processing specifically for Portfolio report exports
function preprocessPortfolioExportData(data) {
  return data.map(row => {
    const mapped = {};

    PORTFOLIO_EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];

      // Date fields - check if already formatted (contains dashes in DD-MM-YYYY format)
      if (['value_date', 'trade_date', 'maturity_date'].includes(col.key)) {
        // If already formatted as string (DD-MM-YYYY), use as-is, otherwise format
        if (val && typeof val === 'string' && val.match(/^\d{2}-\d{2}-\d{4}$/)) {
          // Already formatted, use as-is
        } else {
          val = formatDate(val);
        }
      }

      // Numeric fields - check if already formatted (contains commas)
      if (
        ['face_value', 'clean_price', 'dirty_price', 'settlement_amount', 'maturity_amount', 'amount'].includes(col.key)
      ) {
        // If already formatted with commas, use as-is, otherwise format
        if (val && typeof val === 'string' && val.includes(',')) {
          // Already formatted, use as-is
        } else {
          val = formatNumber2(val);
        }
      }

      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });

    return mapped;
  });
}

function preprocessRepoExportData(data) {
  return (data || []).map(row => {
    const mapped = {};
    REPO_EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (['trade_date', 'value_date', 'maturity_date'].includes(col.key)) {
        val = formatDate(val);
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

exports.export = async (format, data) => {
  // Always format dates for export
  const processedData = preprocessExportData(data);

  if (format === 'csv') {
    const parser = new Parser({ fields: EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key })) });
    return parser.parse(processedData);
  }
  if (format === 'excel') {
    const numeric2dpKeys = new Set(['face_value', 'sell_back']);
    const numeric4dpKeys = new Set([
      'coupon_interest',
      'yield',
      'balance',
      'available_balance',
      'clean_price',
      'dirty_price',
      'nvp',
      'wap',
      'repo_collateral'
    ]);
    const intKeys = new Set(['dtm']);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GSec Report');
    sheet.columns = EXPORT_COLUMNS.map(col => ({ header: col.label, key: col.key }));

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of numeric4dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of intKeys) {
        const n = toExcelNumber(next[k]);
        next[k] = n === null ? null : Math.trunc(n);
      }
      return next;
    });

    sheet.addRows(excelRows);

    // Apply number formats so values remain numeric (AutoSum works) but display nicely
    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of numeric4dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    for (const k of intKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '0';
    }

    return workbook.xlsx.writeBuffer();
  }
  if (format === 'pdf') {
    // Use landscape orientation for wider tables
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('GSec Product Report', { align: 'center' });
    doc.moveDown(1);

    // Table setup with all columns
    const columns = [
      { key: 'portfolio', label: 'Portfolio', width: 50, align: 'left' },
      { key: 'custodian', label: 'Custodian', width: 60, align: 'left' },
      { key: 'deal_number', label: 'Deal Number', width: 60, align: 'left' },
      { key: 'face_value', label: 'Face Value', width: 50, align: 'right' },
      { key: 'value_date', label: 'Value Date', width: 60, align: 'center' },
      { key: 'maturity_date', label: 'Maturity Date', width: 70, align: 'center' },
      { key: 'isin', label: 'ISIN', width: 80, align: 'left' },
      { key: 'coupon_interest', label: 'Coupon Interest', width: 60, align: 'right' },
      { key: 'clean_price', label: 'Clean Price', width: 50, align: 'right' },
      { key: 'dirty_price', label: 'Dirty Price', width: 50, align: 'right' },
      { key: 'nvp', label: 'NVP', width: 50, align: 'right' },
      { key: 'yield', label: 'Yield', width: 40, align: 'right' },
      { key: 'dtm', label: 'DTM', width: 40, align: 'center' },
      { key: 'balance', label: 'Balance', width: 60, align: 'right' },
      { key: 'available_balance', label: 'Available Balance', width: 60, align: 'right' },
      { key: 'wap', label: 'WAP', width: 50, align: 'right' },
      { key: 'repo_collateral', label: 'Repo Collateral', width: 60, align: 'right' },
      { key: 'sell_back', label: 'Sell Back', width: 60, align: 'right' },
      { key: 'counterparty', label: 'Counterparty', width: 50, align: 'left' }
    ];

    // Auto-scale columns to fit PDF page
    function scaleColumnsToPage(columns, doc) {
      const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
      if (totalWidth > maxWidth) {
        const scale = maxWidth / totalWidth;
        columns.forEach(col => { col.width = Math.floor(col.width * scale); });
      }
      return columns;
    }

    const scaledColumns = scaleColumnsToPage(columns, doc);
    const rowHeight = 25;
    const cellPadding = 4;
    const startX = doc.page.margins.left;
    const maxRowsPerPage = Math.floor((doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 100) / rowHeight);

    // Function to draw table header
    function drawTableHeader(doc, y) {
      const tableTop = y;
      const totalWidth = scaledColumns.reduce((a, c) => a + c.width, 0);
      
      // Header background
      doc.rect(startX, tableTop, totalWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      
      let x = startX;
      scaledColumns.forEach(col => {
        doc.text(col.label, x + cellPadding, tableTop + 6, { 
          width: col.width - 2 * cellPadding, 
          align: col.align || 'left'
        });
        x += col.width;
      });
      
      return tableTop + rowHeight;
    }

    // Function to draw table rows with page break handling
    function drawTableRows(doc, data, startRow = 0) {
      let currentY = doc.y;
      let rowIndex = startRow;
      
      while (rowIndex < data.length) {
        // Check if we need a new page
        if (currentY + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          currentY = drawTableHeader(doc, doc.page.margins.top + 20);
        }
        
        const row = data[rowIndex];
        const totalWidth = scaledColumns.reduce((a, c) => a + c.width, 0);
        
        // Alternating row background
        if (rowIndex % 2 === 1) {
          doc.rect(startX, currentY, totalWidth, rowHeight).fill('#f8f8f8');
        }
        
        // Draw row content
        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        scaledColumns.forEach(col => {
          let val = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(val, x + cellPadding, currentY + 6, { 
            width: col.width - 2 * cellPadding, 
            align: col.align || 'left'
          });
          x += col.width;
        });
        
        // Draw row border
        doc.rect(startX, currentY, totalWidth, rowHeight).stroke('#cccccc');
        
        currentY += rowHeight;
        rowIndex++;
      }
      
      return currentY;
    }

    // Draw header
    const headerY = drawTableHeader(doc, doc.page.margins.top + 50);
    
    // Draw all rows with page break handling
    drawTableRows(doc, processedData, 0);

    // Add summary at the end
    doc.addPage();
    doc.fontSize(16).font('Helvetica-Bold').text('Summary', { align: 'center' });
    doc.moveDown(1);
    
    const totalBalance = data.reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
    const formattedTotalBalance = new Intl.NumberFormat('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    }).format(Math.trunc(totalBalance * 100) / 100);
    
    doc.fontSize(12).font('Helvetica').text(`Total Records: ${data.length}`, { align: 'left' });
    doc.text(`Total Balance: ${formattedTotalBalance}`, { align: 'left' });
    
    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }
  throw new Error('Unsupported export format');
};

// Portfolio report export (Excel/CSV/PDF) – uses portfolio-specific columns
exports.exportPortfolio = async (format, data) => {
  // Debug: Log first row to see what fields are available
  if (data && data.length > 0) {
    console.log('Portfolio Export - First row fields:', Object.keys(data[0]));
    console.log('Portfolio Export - First row sample:', JSON.stringify(data[0], null, 2));
  }
  
  const processedData = preprocessPortfolioExportData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: PORTFOLIO_EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const numeric2dpKeys = new Set([
      'face_value',
      'clean_price',
      'dirty_price',
      'settlement_amount',
      'maturity_amount',
      'amount'
    ]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Portfolio Report');
    sheet.columns = PORTFOLIO_EXPORT_COLUMNS.map(col => ({
      header: col.label,
      key: col.key
    }));

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('Portfolio Report', { align: 'center' });
    doc.moveDown(1);

    // Simple table layout reusing the same columns
    const columns = PORTFOLIO_EXPORT_COLUMNS.map(col => ({
      key: col.key,
      label: col.label,
      width: 70,
      align: ['face_value', 'clean_price', 'dirty_price', 'settlement_amount', 'maturity_amount', 'amount'].includes(col.key)
        ? 'right'
        : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach(col => {
        col.width = Math.floor(col.width * scale);
      });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');

      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 5, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }

        const rowWidth = columns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) {
          doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        }

        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        columns.forEach(col => {
          const text = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(text, x + cellPadding, y + 5, {
            width: col.width - 2 * cellPadding,
            align: col.align
          });
          x += col.width;
        });

        doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }

  throw new Error('Unsupported export format');
};

// Repo report export (Excel/CSV/PDF)
exports.exportRepo = async (format, data) => {
  const processedData = preprocessRepoExportData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: REPO_EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Repo Report');
    sheet.columns = REPO_EXPORT_COLUMNS.map(col => ({
      header: col.label,
      key: col.key
    }));

    const numeric2dpKeys = new Set(['principal_amount', 'rate', 'interest_amount', 'maturity_amount', 'face_value_as_per_counterparty']);
    const intKeys = new Set(['tenor']);

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of intKeys) {
        const n = toExcelNumber(next[k]);
        next[k] = n === null ? null : Math.trunc(n);
      }
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }
    for (const k of intKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '0';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    doc.fontSize(20).font('Helvetica-Bold').text('Repo Report', { align: 'center' });
    doc.moveDown(1);

    const columns = REPO_EXPORT_COLUMNS.map(col => ({
      key: col.key,
      label: col.label,
      width: ['principal_amount', 'rate', 'tenor', 'interest_amount', 'maturity_amount', 'face_value_as_per_counterparty'].includes(col.key)
        ? 70
        : 80,
      align: ['principal_amount', 'rate', 'tenor', 'interest_amount', 'maturity_amount', 'face_value_as_per_counterparty'].includes(col.key)
        ? 'right'
        : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach(col => {
        col.width = Math.floor(col.width * scale);
      });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');

      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 5, {
          width: col.width - 2 * cellPadding,
          align: col.align
        });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }

        const rowWidth = columns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) {
          doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        }

        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        columns.forEach(col => {
          const text = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(text, x + cellPadding, y + 5, {
            width: col.width - 2 * cellPadding,
            align: col.align
          });
          x += col.width;
        });

        doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }

  throw new Error('Unsupported export format');
};

// Mark to Market report export columns
const MARK_TO_MARKET_EXPORT_COLUMNS = [
  { key: 'series', label: 'Series' },
  { key: 'isin', label: 'ISIN' },
  { key: 'isin_issuer', label: 'ISIN Issuer' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'buying_price', label: 'Buying Price' },
  { key: 'selling_price', label: 'Selling Price' },
  { key: 'average_price', label: 'Average Price' },
  { key: 'buying_yield', label: 'Buying Yield (%)' },
  { key: 'selling_yield', label: 'Selling Yield (%)' },
  { key: 'average_yield', label: 'Average Yield (%)' },
  { key: 'unrealized_gain', label: 'Unrealized Gain' },
  { key: 'last_updated', label: 'Last Updated' },
  { key: 'excel_source', label: 'Source' }
];

function preprocessMarkToMarketData(data) {
  return (data || []).map(row => {
    const mapped = {};
    MARK_TO_MARKET_EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (col.key === 'maturity_date' || col.key === 'last_updated') {
        val = formatDate(val);
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

exports.exportMarkToMarket = async (format, data) => {
  const processedData = preprocessMarkToMarketData(data);

  if (format === 'csv') {
    const parser = new Parser({
      fields: MARK_TO_MARKET_EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(processedData);
  }

  if (format === 'excel') {
    const numeric4dpKeys = new Set(['buying_price', 'selling_price', 'average_price', 'unrealized_gain']);
    const numeric2dpKeys = new Set(['buying_yield', 'selling_yield', 'average_yield']);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Mark to Market Report');
    sheet.columns = MARK_TO_MARKET_EXPORT_COLUMNS.map(col => ({ header: col.label, key: col.key }));

    const excelRows = processedData.map(row => {
      const next = { ...row };
      for (const k of numeric4dpKeys) next[k] = toExcelNumber(next[k]);
      for (const k of numeric2dpKeys) next[k] = toExcelNumber(next[k]);
      return next;
    });

    sheet.addRows(excelRows);

    for (const k of numeric4dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.0000';
    }
    for (const k of numeric2dpKeys) {
      const col = sheet.getColumn(k);
      if (col) col.numFmt = '#,##0.00';
    }

    return workbook.xlsx.writeBuffer();
  }

  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    doc.fontSize(20).font('Helvetica-Bold').text('Mark to Market Report', { align: 'center' });
    doc.moveDown(1);

    const columns = MARK_TO_MARKET_EXPORT_COLUMNS.map(col => ({
      key: col.key,
      label: col.label,
      width: 70,
      align: ['buying_price', 'selling_price', 'average_price', 'buying_yield', 'selling_yield', 'average_yield', 'unrealized_gain'].includes(col.key) ? 'right' : 'left'
    }));

    const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);
    if (totalWidth > maxWidth) {
      const scale = maxWidth / totalWidth;
      columns.forEach(col => { col.width = Math.floor(col.width * scale); });
    }

    const rowHeight = 20;
    const cellPadding = 4;
    const startX = doc.page.margins.left;

    function drawHeader(y) {
      const headerWidth = columns.reduce((sum, col) => sum + col.width, 0);
      doc.rect(startX, y, headerWidth, rowHeight).fillAndStroke('#f0f0f0', '#000000');
      doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
      let x = startX;
      columns.forEach(col => {
        doc.text(col.label, x + cellPadding, y + 5, { width: col.width - 2 * cellPadding, align: col.align });
        x += col.width;
      });
      return y + rowHeight;
    }

    function drawRows(startY) {
      let y = startY;
      processedData.forEach((row, index) => {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          y = drawHeader(doc.page.margins.top);
        }
        const rowWidth = columns.reduce((sum, col) => sum + col.width, 0);
        if (index % 2 === 1) doc.rect(startX, y, rowWidth, rowHeight).fill('#f8f8f8');
        doc.font('Helvetica').fontSize(8).fillColor('#000000');
        let x = startX;
        columns.forEach(col => {
          const text = row[col.key] !== undefined ? String(row[col.key]) : '';
          doc.text(text, x + cellPadding, y + 5, { width: col.width - 2 * cellPadding, align: col.align });
          x += col.width;
        });
        doc.rect(startX, y, rowWidth, rowHeight).stroke('#cccccc');
        y += rowHeight;
      });
    }

    const headerY = drawHeader(doc.page.margins.top);
    drawRows(headerY);

    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
  }

  throw new Error('Unsupported export format');
};

// Counterparty Master Report Export Columns
const COUNTERPARTY_MASTER_COLUMNS = [
  { key: 'counterparty_type', label: 'Counterparty Type' },
  { key: 'cux_number', label: 'CUX Number' },
  { key: 'title', label: 'Title' },
  { key: 'short_name', label: 'Short Name' },
  { key: 'long_name', label: 'Long Name' },
  { key: 'company_name', label: 'Company Name' },
  { key: 'id_type', label: 'ID Type' },
  { key: 'nic_number', label: 'NIC Number' },
  { key: 'registration_number', label: 'Registration Number' },
  { key: 'tin_number', label: 'TIN Number' },
  { key: 'vat_number', label: 'VAT Number' },
  { key: 'address', label: 'Address' },
  { key: 'telephone', label: 'Telephone' },
  { key: 'email', label: 'Email' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'custodian_bank', label: 'Custodian Bank' },
  { key: 'cds_account', label: 'CDS Account' }
];

exports.exportCounterpartyMaster = async (format, data) => {
  if (format === 'csv') {
    const parser = new Parser({ 
      fields: COUNTERPARTY_MASTER_COLUMNS.map(col => ({ label: col.label, value: col.key }))
    });
    return parser.parse(data);
  }
  
  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Counterparty Master');
    
    // Set column headers
    sheet.columns = COUNTERPARTY_MASTER_COLUMNS.map(col => ({ 
      header: col.label, 
      key: col.key,
      width: 20
    }));
    
    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Add data rows
    sheet.addRows(data);
    
    // Auto-fit columns
    sheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = maxLength < 10 ? 10 : maxLength > 50 ? 50 : maxLength + 2;
    });
    
    return workbook.xlsx.writeBuffer();
  }
  
  if (format === 'pdf') {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});
    
    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('Counterparty Master Report', { align: 'center' });
    doc.moveDown(1);
    
    // Table columns
    const columns = [
      { key: 'counterparty_type', label: 'Type', width: 50 },
      { key: 'cux_number', label: 'CUX', width: 60 },
      { key: 'short_name', label: 'Short Name', width: 80 },
      { key: 'long_name', label: 'Long Name', width: 100 },
      { key: 'nic_number', label: 'NIC', width: 70 },
      { key: 'email', label: 'Email', width: 100 },
      { key: 'telephone', label: 'Phone', width: 70 },
      { key: 'address', label: 'Address', width: 120 }
    ];
    
    // Draw header
    let y = doc.y;
    const rowHeight = 25;
    const startX = doc.page.margins.left;
    let x = startX;
    
    doc.rect(startX, y, columns.reduce((sum, col) => sum + col.width, 0), rowHeight)
       .fillAndStroke('#f0f0f0', '#000000');
    doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
    
    columns.forEach(col => {
      doc.text(col.label, x + 4, y + 6, { width: col.width - 8 });
      x += col.width;
    });
    
    y += rowHeight;
    
    // Draw rows
    data.forEach((row, index) => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top + 20;
        x = startX;
        doc.rect(startX, y, columns.reduce((sum, col) => sum + col.width, 0), rowHeight)
           .fillAndStroke('#f0f0f0', '#000000');
        doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
        columns.forEach(col => {
          doc.text(col.label, x + 4, y + 6, { width: col.width - 8 });
          x += col.width;
        });
        y += rowHeight;
        x = startX;
      }
      
      doc.fontSize(8).font('Helvetica');
      columns.forEach(col => {
        const value = String(row[col.key] || '');
        doc.text(value.substring(0, 30), x + 4, y + 6, { width: col.width - 8 });
        x += col.width;
      });
      y += rowHeight;
      x = startX;
    });
    
    doc.end();
    
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }
  
  throw new Error('Unsupported export format');
};

exports.getMimeType = (format) => {
  if (format === 'csv') return 'text/csv';
  if (format === 'excel') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (format === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
};