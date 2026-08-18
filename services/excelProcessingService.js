const XLSX = require('xlsx');
const fs = require('fs');

class ExcelProcessingService {
  
  /**
   * Process Excel file and extract T-bond and T-bill quote rows.
   * @returns {{ bonds: Array, bills: Array }}
   */
  async processExcelFile(filePath) {
    try {
      console.log('🔍 Processing Excel file:', filePath);

      const workbook = XLSX.readFile(filePath);
      const sheetNames = workbook.SheetNames;
      console.log('📋 Found sheets:', sheetNames);

      let bondSheetName = null;
      let billSheetName = null;
      const sheetRows = {};

      for (const name of sheetNames) {
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
        sheetRows[name] = jsonData;
        if (!jsonData.length) continue;
        const probe = [];
        for (let i = 0; i < Math.min(8, jsonData.length); i += 1) {
          probe.push(...(jsonData[i] || []));
        }
        if (!billSheetName && this.isTreasuryBillsSheet(probe, name)) {
          billSheetName = name;
        } else if (!bondSheetName && this.isTreasuryBondsSheet(probe, name)) {
          bondSheetName = name;
        }
      }

      if (!bondSheetName && sheetNames[0] && !billSheetName) {
        bondSheetName = sheetNames[0];
      }

      let bonds = [];
      if (bondSheetName) {
        const jsonData = sheetRows[bondSheetName] || [];
        if (jsonData.length >= 2) {
          const headerRowIndex = this.findHeaderRow(jsonData, 'bond');
          bonds = this.parseTreasuryBondData(jsonData, headerRowIndex);
          console.log(`✅ Extracted ${bonds.length} treasury bond records from ${bondSheetName}`);
        }
      }

      let bills = [];
      if (billSheetName) {
        const jsonData = sheetRows[billSheetName] || [];
        if (jsonData.length >= 2) {
          const headerRowIndex = this.findHeaderRow(jsonData, 'bill');
          bills = this.parseTreasuryBillData(jsonData, headerRowIndex);
          console.log(`✅ Extracted ${bills.length} treasury bill records from ${billSheetName}`);
        }
      }

      return { bonds, bills };
    } catch (error) {
      console.error('❌ Error processing Excel file:', error);
      throw error;
    }
  }

  headerText(headers) {
    if (!headers || headers.length === 0) return '';
    return headers.map((h) => (h ? h.toString().toLowerCase() : '')).join(' ');
  }

  isTreasuryBillsSheet(headers, sheetName = '') {
    const headerText = `${this.headerText(headers)} ${String(sheetName).toLowerCase()}`;
    const hasBill = headerText.includes('bill') || headerText.includes('tbill') || headerText.includes('t-bill');
    if (!hasBill) return false;
    return (
      headerText.includes('treasury') ||
      headerText.includes('yield') ||
      headerText.includes('isin') ||
      headerText.includes('price')
    );
  }

  isTreasuryBondsSheet(headers, sheetName = '') {
    if (this.isTreasuryBillsSheet(headers, sheetName)) return false;
    const headerText = `${this.headerText(headers)} ${String(sheetName).toLowerCase()}`;
    const treasuryKeywords = [
      'series', 'treasury', 'bond', 'maturity', 'yield',
      'buying', 'selling', 'price', 'spread'
    ];
    const matchCount = treasuryKeywords.filter((keyword) => headerText.includes(keyword)).length;
    return matchCount >= 3;
  }

  findHeaderRow(rows, kind = 'bond') {
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const row = rows[i];
      if (!row || !row.length) continue;
      const headerText = this.headerText(row);
      if (kind === 'bill') {
        if (
          (headerText.includes('bill') && (headerText.includes('treasury') || headerText.includes('yield'))) ||
          (headerText.includes('isin') && headerText.includes('yield')) ||
          (headerText.includes('series') && headerText.includes('bill'))
        ) {
          return i;
        }
      } else if (headerText.includes('treasury') && headerText.includes('series')) {
        return i;
      }
    }
    return 0;
  }

  /**
   * Check if a row contains actual data (not just headers or empty rows)
   */
  isDataRow(row) {
    if (!row || row.length === 0) return false;
    const nonEmptyCells = row.filter((cell) => cell && cell.toString().trim() !== '');
    if (nonEmptyCells.length < 3) return false;
    const seriesCell = row[2];
    if (seriesCell && typeof seriesCell === 'string' && seriesCell.includes('%')) {
      return true;
    }
    const joined = row.map((c) => (c ? c.toString() : '')).join(' ').toUpperCase();
    if (joined.includes('LKB') || joined.includes('LKA')) return true;
    return false;
  }

  isTbillDataRow(row, columnMap) {
    if (!row || row.length === 0) return false;
    const nonEmptyCells = row.filter((cell) => cell && cell.toString().trim() !== '');
    if (nonEmptyCells.length < 2) return false;
    const isinIdx = columnMap.isinNumber >= 0 ? columnMap.isinNumber : -1;
    const seriesIdx = columnMap.series >= 0 ? columnMap.series : 2;
    const isinCell = isinIdx >= 0 ? String(row[isinIdx] || '').toUpperCase() : '';
    if (isinCell.includes('LKA') || isinCell.includes('LKB')) return true;
    const seriesCell = String(row[seriesIdx] || '').trim();
    if (seriesCell && !/^(series|isin|treasury|maturity)$/i.test(seriesCell)) return true;
    return nonEmptyCells.length >= 3;
  }

  resolveBondColumnMap(headers) {
    const byKeyword = {
      isinNumber: this.findColumnIndex(headers, ['isin']),
      series: this.findColumnIndex(headers, ['series']),
      maturityPeriod: this.findColumnIndex(headers, ['maturity period', 'tenor', 'years']),
      maturityDate: this.findColumnIndex(headers, ['maturity date']),
      daysToMaturity: this.findColumnIndex(headers, ['days to maturity', 'days']),
      buyingPrice: this.findColumnIndex(headers, ['buying price', 'average buying']),
      buyingYield: this.findColumnIndex(headers, ['buying yield']),
      sellingPrice: this.findColumnIndex(headers, ['selling price', 'average selling']),
      sellingYield: this.findColumnIndex(headers, ['selling yield'])
    };
    const fallback = {
      isinNumber: -1,
      series: 2,
      maturityPeriod: 3,
      maturityDate: 4,
      daysToMaturity: 5,
      buyingPrice: 6,
      buyingYield: 7,
      sellingPrice: 8,
      sellingYield: 9
    };
    const map = {};
    for (const key of Object.keys(fallback)) {
      map[key] = byKeyword[key] >= 0 ? byKeyword[key] : fallback[key];
    }
    return map;
  }

  finalizeQuoteRow(rowData) {
    if (rowData.buyingPrice && rowData.sellingPrice) {
      rowData.averagePrice = (rowData.buyingPrice + rowData.sellingPrice) / 2;
    } else {
      rowData.averagePrice = rowData.buyingPrice || rowData.sellingPrice || null;
    }
    if (rowData.buyingYield && rowData.sellingYield) {
      rowData.averageYield = (rowData.buyingYield + rowData.sellingYield) / 2;
    } else {
      rowData.averageYield = rowData.buyingYield || rowData.sellingYield || null;
    }
    return rowData;
  }

  parseTreasuryBondData(rows, headerRowIndex = 0) {
    const headers = rows[headerRowIndex].map((h) => (h ? h.toString().toLowerCase().trim() : ''));
    const dataRows = rows.slice(headerRowIndex + 1);
    const columnMap = this.resolveBondColumnMap(headers);
    const extractedData = [];

    dataRows.forEach((row, index) => {
      try {
        if (!this.isDataRow(row)) return;
        const rowData = this.finalizeQuoteRow({
          instrumentType: 'T_BOND',
          isinNumber: this.cleanText(row[columnMap.isinNumber] || ''),
          series: this.cleanText(row[columnMap.series] || ''),
          maturityPeriod: this.parseNumber(row[columnMap.maturityPeriod]),
          maturityDate: this.parseDate(row[columnMap.maturityDate]),
          daysToMaturity: this.parseNumber(row[columnMap.daysToMaturity]),
          buyingPrice: this.parseNumber(row[columnMap.buyingPrice]),
          buyingYield: this.parseYield(row[columnMap.buyingYield]),
          sellingPrice: this.parseNumber(row[columnMap.sellingPrice]),
          sellingYield: this.parseYield(row[columnMap.sellingYield])
        });
        if ((rowData.series || rowData.isinNumber) && (rowData.buyingPrice || rowData.sellingPrice || rowData.averageYield)) {
          extractedData.push(rowData);
        }
      } catch (error) {
        console.warn(`⚠️ Error parsing bond row ${index + 1}:`, error.message);
      }
    });

    return extractedData;
  }

  parseTreasuryBillData(rows, headerRowIndex = 0) {
    const headers = rows[headerRowIndex].map((h) => (h ? h.toString().toLowerCase().trim() : ''));
    const dataRows = rows.slice(headerRowIndex + 1);
    const columnMap = {
      isinNumber: this.findColumnIndex(headers, ['isin']),
      series: this.findColumnIndex(headers, ['series', 'tenor', 'period']),
      maturityDate: this.findColumnIndex(headers, ['maturity date', 'maturity']),
      daysToMaturity: this.findColumnIndex(headers, ['days to maturity', 'days to', 'remaining']),
      buyingPrice: this.findColumnIndex(headers, ['buying price', 'average buying', 'buy price']),
      buyingYield: this.findColumnIndex(headers, ['buying yield', 'buy yield']),
      sellingPrice: this.findColumnIndex(headers, ['selling price', 'average selling', 'sell price']),
      sellingYield: this.findColumnIndex(headers, ['selling yield', 'sell yield'])
    };
    if (columnMap.buyingYield < 0) {
      columnMap.buyingYield = this.findColumnIndex(headers, ['yield']);
    }
    if (columnMap.series < 0) columnMap.series = 2;
    if (columnMap.maturityDate < 0) columnMap.maturityDate = 4;
    if (columnMap.buyingPrice < 0) columnMap.buyingPrice = 6;
    if (columnMap.buyingYield < 0) columnMap.buyingYield = 7;
    if (columnMap.sellingPrice < 0) columnMap.sellingPrice = 8;
    if (columnMap.sellingYield < 0) columnMap.sellingYield = 9;

    const extractedData = [];
    dataRows.forEach((row, index) => {
      try {
        if (!this.isTbillDataRow(row, columnMap)) return;
        const rowData = this.finalizeQuoteRow({
          instrumentType: 'T_BILL',
          isinNumber: this.cleanText(row[columnMap.isinNumber] || ''),
          series: this.cleanText(row[columnMap.series] || ''),
          maturityDate: this.parseDate(row[columnMap.maturityDate]),
          daysToMaturity: this.parseNumber(row[columnMap.daysToMaturity]),
          buyingPrice: this.parseNumber(row[columnMap.buyingPrice]),
          buyingYield: this.parseYield(row[columnMap.buyingYield]),
          sellingPrice: this.parseNumber(row[columnMap.sellingPrice]),
          sellingYield: this.parseYield(row[columnMap.sellingYield])
        });
        if (
          (rowData.series || rowData.isinNumber || rowData.maturityDate) &&
          (rowData.buyingPrice || rowData.sellingPrice || rowData.averageYield)
        ) {
          extractedData.push(rowData);
        }
      } catch (error) {
        console.warn(`⚠️ Error parsing bill row ${index + 1}:`, error.message);
      }
    });
    return extractedData;
  }

  /**
   * Find column index by searching for keywords
   */
  findColumnIndex(headers, keywords) {
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (header && typeof header === 'string' && keywords.some(keyword => header.includes(keyword))) {
        console.log(`🔍 Found column "${keywords.find(k => header.includes(k))}" at index ${i}`);
        return i;
      }
    }
    console.log(`❌ No column found for keywords: ${keywords.join(', ')}`);
    return -1;
  }

  /**
   * Clean and parse text
   */
  cleanText(text) {
    if (!text) return '';
    return text.toString().replace(/\s+/g, ' ').trim();
  }

  /**
   * Parse number values with enhanced handling
   */
  parseNumber(value) {
    if (!value) return null;
    
    try {
      // Handle percentage values
      if (typeof value === 'string' && value.includes('%')) {
        const cleaned = value.replace(/[^\d.-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      }
      
      // Handle regular numbers
      if (typeof value === 'number') {
        return isNaN(value) ? null : value;
      }
      
      // Handle string numbers
      if (typeof value === 'string') {
        // Remove common non-numeric characters
        const cleaned = value.replace(/[^\d.-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      }
      
      return null;
      
    } catch (error) {
      console.warn('Error parsing number:', value, error.message);
      return null;
    }
  }

  /**
   * Parse yield values and convert from decimal to percentage
   */
  parseYield(value) {
    if (!value) return null;
    
    try {
      let num;
      
      // Handle percentage values (already in percentage format)
      if (typeof value === 'string' && value.includes('%')) {
        const cleaned = value.replace(/[^\d.-]/g, '');
        num = parseFloat(cleaned);
      }
      // Handle decimal values (convert to percentage)
      else if (typeof value === 'number') {
        num = value * 100; // Convert decimal to percentage
      }
      // Handle string numbers
      else if (typeof value === 'string') {
        const cleaned = value.replace(/[^\d.-]/g, '');
        num = parseFloat(cleaned) * 100; // Convert decimal to percentage
      }
      
      return isNaN(num) ? null : num;
      
    } catch (error) {
      console.warn('Error parsing yield:', value, error.message);
      return null;
    }
  }

  /**
   * Parse date values with Excel date handling
   */
  parseDate(value) {
    if (!value) return null;
    
    try {
      // Handle Excel date numbers (days since 1900-01-01)
      if (typeof value === 'number') {
        // Excel dates are number of days since 1900-01-01
        const excelEpoch = new Date(1900, 0, 1);
        const date = new Date(excelEpoch.getTime() + (value - 1) * 24 * 60 * 60 * 1000);
        return date.toISOString().split('T')[0];
      }
      
      // Handle string dates
      if (typeof value === 'string') {
        // Try various date formats
        const dateFormats = [
          /(\d{1,2})-(\w{3})-(\d{2,4})/, // 15-Oct-25
          /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/, // 15/10/2025
          /(\d{4})-(\d{1,2})-(\d{1,2})/ // 2025-10-15
        ];
        
        for (const format of dateFormats) {
          const match = value.match(format);
          if (match) {
            if (match[1].length === 4) {
              // YYYY-MM-DD format
              return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
            } else if (match[3].length === 4) {
              // DD-MM-YYYY format
              const month = this.getMonthNumber(match[2]);
              return `${match[3]}-${month}-${match[1].padStart(2, '0')}`;
            } else {
              // DD-MM-YY format
              const month = this.getMonthNumber(match[2]);
              const year = match[3].length === 2 ? `20${match[3]}` : match[3];
              return `${year}-${month}-${match[1].padStart(2, '0')}`;
            }
          }
        }
        
        // Try direct Date parsing
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
      
      return null;
      
    } catch (error) {
      console.error('❌ Error parsing date:', value, error);
      return null;
    }
  }

  /**
   * Convert month abbreviation to number
   */
  getMonthNumber(monthAbbr) {
    const months = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
      'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
      'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    
    return months[monthAbbr.toLowerCase()] || '01';
  }
}

module.exports = new ExcelProcessingService();