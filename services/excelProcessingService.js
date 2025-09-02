const XLSX = require('xlsx');
const fs = require('fs');

class ExcelProcessingService {
  
  /**
   * Process Excel file and extract treasury bond data
   * @param {string} filePath - Path to the uploaded Excel file
   * @returns {Array} Array of extracted treasury bond records
   */
  async processExcelFile(filePath) {
    try {
      console.log('🔍 Processing Excel file:', filePath);
      
      // Read Excel file
      const workbook = XLSX.readFile(filePath);
      
      // Get all sheet names
      const sheetNames = workbook.SheetNames;
      console.log('📋 Found sheets:', sheetNames);
      
      // Get the first sheet (or search for treasury bonds sheet)
      let worksheet = workbook.Sheets[sheetNames[0]];
      let sheetName = sheetNames[0];
      
      // Try to find a sheet with treasury bond data
      for (const name of sheetNames) {
        const sheet = workbook.Sheets[name];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        if (jsonData.length > 0 && this.isTreasuryBondsSheet(jsonData[0])) {
          worksheet = sheet;
          sheetName = name;
          console.log('🎯 Found treasury bonds sheet:', name);
          break;
        }
      }
      
      // Convert to JSON with headers
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length < 2) {
        throw new Error('Excel file must have at least header and data rows');
      }
      
      console.log(`📊 Processing ${jsonData.length} rows from sheet: ${sheetName}`);
      
      // Find the actual header row
      const headerRowIndex = this.findHeaderRow(jsonData);
      console.log(`📋 Using header row at index: ${headerRowIndex}`);
      
      // Parse the data starting from the header row
      const extractedData = this.parseTreasuryBondData(jsonData, headerRowIndex);
      
      console.log(`✅ Successfully extracted ${extractedData.length} treasury bond records`);
      return extractedData;
      
    } catch (error) {
      console.error('❌ Error processing Excel file:', error);
      throw error;
    }
  }

  /**
   * Check if a sheet contains treasury bond data
   */
  isTreasuryBondsSheet(headers) {
    if (!headers || headers.length === 0) return false;
    
    const headerText = headers.map(h => h ? h.toString().toLowerCase() : '').join(' ');
    
    const treasuryKeywords = [
      'series', 'treasury', 'bond', 'maturity', 'yield', 
      'buying', 'selling', 'price', 'spread'
    ];
    
    const matchCount = treasuryKeywords.filter(keyword => 
      headerText.includes(keyword)
    ).length;
    
    return matchCount >= 3; // At least 3 keywords must match
  }

  /**
   * Find the header row in Excel data
   */
  findHeaderRow(rows) {
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const row = rows[i];
      if (row && row.length > 0) {
        const headerText = row.map(h => h ? h.toString().toLowerCase() : '').join(' ');
        if (headerText.includes('treasury') && headerText.includes('series')) {
          console.log(`🎯 Found header row at index ${i}:`, row);
          return i;
        }
      }
    }
    return 0; // Default to first row
  }

  /**
   * Check if a row contains actual data (not just headers or empty rows)
   */
  isDataRow(row) {
    if (!row || row.length === 0) return false;
    
    // Check if row has at least 3 non-empty cells
    const nonEmptyCells = row.filter(cell => cell && cell.toString().trim() !== '');
    if (nonEmptyCells.length < 3) return false;
    
    // Check if the series cell (index 2) looks like a series name (contains %)
    const seriesCell = row[2];
    if (seriesCell && typeof seriesCell === 'string' && seriesCell.includes('%')) {
      return true;
    }
    
    return false;
  }

  /**
   * Parse treasury bond data from Excel rows
   */
  parseTreasuryBondData(rows, headerRowIndex = 0) {
    const headers = rows[headerRowIndex].map(h => h ? h.toString().toLowerCase().trim() : '');
    const dataRows = rows.slice(headerRowIndex + 1);
    
    console.log('📋 Excel headers found:', headers);
    
    // Map column indices based on your specific Excel file structure
    // Based on the debug output, the columns are at specific indices
    const columnMap = {
      series: 2,        // "Treasury Bond By Series" - contains series like "22.50%2025A"
      maturityPeriod: 3, // "Maturity Period (Years)" - contains years like 3, 8
      maturityDate: 4,   // "Maturity Date (DD/MM/YY)" - contains Excel date numbers
      daysToMaturity: 5, // "Days to Maturity" - contains days like -201, 72
      buyingPrice: 6,    // "Average Buying Price" - contains prices like 100.44
      buyingYield: 7,    // "Yield" (first yield column) - contains yields like 0.078
      sellingPrice: 8,   // "Average Selling Price" - contains prices like 100.48
      sellingYield: 9,   // "Yield" (second yield column) - contains yields like 0.075
      spread: 10         // "Buying & Selling Spread" - contains spreads like 0.044
    };
    
    console.log('🔗 Column mapping:', columnMap);
    
    const extractedData = [];
    
    dataRows.forEach((row, index) => {
      try {
        // Skip empty rows or non-data rows
        if (!this.isDataRow(row)) {
          return;
        }
        
        const rowData = {
          series: this.cleanText(row[columnMap.series] || ''),
          maturityPeriod: this.parseNumber(row[columnMap.maturityPeriod]),
          maturityDate: this.parseDate(row[columnMap.maturityDate]),
          daysToMaturity: this.parseNumber(row[columnMap.daysToMaturity]),
          buyingPrice: this.parseNumber(row[columnMap.buyingPrice]),
          buyingYield: this.parseNumber(row[columnMap.buyingYield]),
          sellingPrice: this.parseNumber(row[columnMap.sellingPrice]),
          sellingYield: this.parseNumber(row[columnMap.sellingYield]),
          spread: this.parseNumber(row[columnMap.spread])
        };
        
        // Calculate averages
        if (rowData.buyingPrice && rowData.sellingPrice) {
          rowData.averagePrice = (rowData.buyingPrice + rowData.sellingPrice) / 2;
        }
        
        if (rowData.buyingYield && rowData.sellingYield) {
          rowData.averageYield = (rowData.buyingYield + rowData.sellingYield) / 2;
        }
        
        // Only add if we have essential data
        if (rowData.series && (rowData.buyingPrice || rowData.sellingPrice)) {
          extractedData.push(rowData);
          console.log(`✅ Parsed row ${index + 1}: ${rowData.series}`);
        } else {
          console.log(`⚠️ Skipped row ${index + 1}: Insufficient data`);
        }
        
      } catch (error) {
        console.warn(`⚠️ Error parsing row ${index + 1}:`, error.message);
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