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
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'custodian', label: 'Custodian' },
  { key: 'deal_number', label: 'Deal Number' },
  { key: 'face_value', label: 'Face Value' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'isin', label: 'ISIN' },
  { key: 'coupon_interest', label: 'Coupon Interest' },
  { key: 'clean_price', label: 'Clean Price' },
  { key: 'nvp', label: 'NVP' },
  { key: 'yield', label: 'Yield' },
  { key: 'dtm', label: 'DTM' },
  { key: 'balance', label: 'Balance' },
  { key: 'wap', label: 'WAP' },
  { key: 'repo_collateral', label: 'Repo Collateral' },
  { key: 'sell_back', label: 'Sell Back' },
  { key: 'counterparty', label: 'Counterparty' }
];

function formatNumber2(val) {
  if (val === undefined || val === null || val === '') return '';
  const n = Number(val);
  if (isNaN(n)) return val;
  // Truncate (not round) to 2 decimals
  const truncated = Math.trunc(n * 100) / 100;
  // Format with comma separators and exactly 2 decimal places
  return new Intl.NumberFormat('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(truncated);
}

function preprocessExportData(data) {
  // Compute WAP per ISIN
  const isinMap = {};
  data.forEach(row => {
    const isin = row.isin;
    const fv = Number(row.face_value) || 0;
    const cp = Number(row.clean_price) || 0;
    if (!isinMap[isin]) {
      isinMap[isin] = { sumFV: 0, sumFVCP: 0 };
    }
    isinMap[isin].sumFV += fv;
    isinMap[isin].sumFVCP += fv * cp;
  });
  // Attach WAP to each row
  return data.map(row => {
    const mapped = {};
    EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (col.key === 'value_date' || col.key === 'maturity_date') {
        val = formatDate(val);
      }
      // Format numbers to 2 decimals with comma separators for specific fields
      if ([
        'coupon_interest',
        'yield',
        'balance',
        'clean_price',
        'nvp',
        'wap',
        'repo_collateral',
        'sell_back'
      ].includes(col.key)) {
        val = formatNumber2(val);
      }
      // DTM is days, so just convert to integer (no decimals or commas)
      if (col.key === 'dtm') {
        const n = Number(val);
        val = isNaN(n) ? val : Math.trunc(n).toString();
      }
      if (col.key === 'wap') {
        const isin = row.isin;
        const wap = isinMap[isin] && isinMap[isin].sumFV ? (isinMap[isin].sumFVCP / isinMap[isin].sumFV) : 0;
        val = formatNumber2(wap);
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
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GSec Report');
    sheet.columns = EXPORT_COLUMNS.map(col => ({ header: col.label, key: col.key }));
    sheet.addRows(processedData);
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
      { key: 'nvp', label: 'NVP', width: 50, align: 'right' },
      { key: 'yield', label: 'Yield', width: 40, align: 'right' },
      { key: 'dtm', label: 'DTM', width: 40, align: 'center' },
      { key: 'balance', label: 'Balance', width: 60, align: 'right' },
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

exports.getMimeType = (format) => {
  if (format === 'csv') return 'text/csv';
  if (format === 'excel') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (format === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
};