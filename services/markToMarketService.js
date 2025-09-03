const db = require('../config/database');
const { pricePer100FromYield } = require('../utils/bondPricing');

class MarkToMarketService {
  
  /**
   * Update mark-to-market data with extracted Excel data
   * @param {Array} extractedData - Data extracted from Excel by excelProcessingService
   * @param {string} excelSource - Original Excel filename
   * @returns {Object} Update results with success/error counts
   */
  async updateMarkToMarketData(extractedData, excelSource) {
    console.log(`🔄 Updating mark-to-market data with ${extractedData.length} records from ${excelSource}`);

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const data of extractedData) {
      try {
        console.log(`🔍 Processing series: ${data.series}`);
        
        // Get ISIN details from isin_master based on series
        const isinDetails = await this.getIsinBySeriesFromDatabase(data.series);
        
        if (isinDetails) {
          console.log(`✅ Found ISIN: ${isinDetails.isin_number} for series: ${data.series}`);
          
          // Calculate dirty price using bond pricing formula
          const dirtyPrice = await this.calculateDirtyPrice({
            isinNumber: isinDetails.isin_number,
            averageYield: data.averageYield,
            maturityDate: data.maturityDate || isinDetails.maturity_date,
            issueDate: isinDetails.issue_date,
            couponRate: isinDetails.coupon_rate,
            couponDate1: isinDetails.coupon_date_1,
            couponDate2: isinDetails.coupon_date_2
          });

          // Insert or update mark-to-market record
          await this.upsertMarkToMarketRecord({
            series: data.series,
            isinNumber: isinDetails.isin_number,
            isinIssuer: isinDetails.isin_issuer,
            maturityDate: data.maturityDate || isinDetails.maturity_date,
            buyingPrice: data.buyingPrice,
            sellingPrice: data.sellingPrice,
            averagePrice: data.averagePrice,
            buyingYield: data.buyingYield,
            sellingYield: data.sellingYield,
            averageYield: data.averageYield,
            dirtyPrice: dirtyPrice,
            excelSource: excelSource
          });

          successCount++;
          console.log(`✅ Successfully updated mark-to-market for series: ${data.series}`);

        } else {
          console.warn(`⚠️ No ISIN found for series: ${data.series} - Skipping`);
          skippedCount++;
        }

      } catch (error) {
        console.error(`❌ Error processing data for series ${data.series}:`, error);
        errorCount++;
      }
    }

    console.log(`📊 Update complete: ${successCount} successful, ${errorCount} errors, ${skippedCount} skipped`);
    return { successCount, errorCount, skippedCount };
  }

  /**
   * Get ISIN details by series from database
   * @param {string} series - Series identifier (e.g., "10.35%2025A")
   * @returns {Object|null} ISIN details or null if not found
   */
  async getIsinBySeriesFromDatabase(series) {
    try {
      console.log(`🔍 Looking up ISIN for series: ${series}`);
      
      const sql = `
        SELECT 
          isin_number, 
          isin_issuer, 
          issue_date, 
          maturity_date, 
          coupon_rate, 
          coupon_date_1, 
          coupon_date_2, 
          series
        FROM isin_master 
        WHERE series = ? 
        LIMIT 1
      `;
      
      const [rows] = await db.query(sql, [series]);
      
      if (rows.length > 0) {
        console.log(`✅ Found ISIN details:`, {
          isin: rows[0].isin_number,
          issuer: rows[0].isin_issuer,
          couponRate: rows[0].coupon_rate,
          maturityDate: rows[0].maturity_date
        });
        return rows[0];
      } else {
        console.log(`❌ No ISIN found for series: ${series}`);
        return null;
      }

    } catch (error) {
      console.error('❌ Error getting ISIN by series:', error);
      return null;
    }
  }

  /**
   * Calculate dirty price using bond pricing formula
   * @param {Object} params - Parameters for dirty price calculation
   * @returns {number|null} Calculated dirty price or null if calculation fails
   */
  async calculateDirtyPrice({ isinNumber, averageYield, maturityDate, issueDate, couponRate, couponDate1, couponDate2 }) {
    try {
      // Validate required parameters
      if (!averageYield || !maturityDate || !issueDate || !couponRate) {
        console.warn('⚠️ Missing data for dirty price calculation:', { 
          averageYield, 
          maturityDate, 
          issueDate, 
          couponRate 
        });
        return null;
      }

      const valueDate = new Date().toISOString().split('T')[0]; // Today's date
      
      console.log('🧮 Calculating dirty price with:', {
        isinNumber,
        couponRate, 
        averageYield, 
        valueDate, 
        maturityDate, 
        issueDate,
        couponDate1,
        couponDate2
      });
      
      // Use the bond pricing utility function
      const pricingResult = pricePer100FromYield({
        couponRate: parseFloat(couponRate),
        yieldRate: parseFloat(averageYield),
        valueDate: valueDate,
        maturityDate: this.formatDate(maturityDate),
        issueDate: this.formatDate(issueDate),
        couponDate1: this.formatCouponDate(couponDate1),
        couponDate2: this.formatCouponDate(couponDate2)
      });

      const dirtyPrice = parseFloat(pricingResult.dirtyPrice) || null;
      
      if (dirtyPrice) {
        console.log(`💰 Calculated dirty price: ${dirtyPrice} for ISIN: ${isinNumber}`);
      } else {
        console.warn(`⚠️ Could not calculate dirty price for ISIN: ${isinNumber}`);
      }
      
      return dirtyPrice;

    } catch (error) {
      console.error('❌ Error calculating dirty price:', error);
      return null;
    }
  }

  /**
   * Insert or update mark-to-market record
   * @param {Object} data - Mark-to-market data to insert/update
   */
  async upsertMarkToMarketRecord(data) {
    const sql = `
      INSERT INTO mark_to_market (
        series, 
        isin_number, 
        isin_issuer, 
        maturity_date,
        buying_price, 
        selling_price, 
        average_price,
        buying_yield, 
        selling_yield, 
        average_yield,
        dirty_price, 
        excel_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
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
        last_updated = CURRENT_TIMESTAMP
    `;

    const values = [
      data.series,
      data.isinNumber,
      data.isinIssuer,
      data.maturityDate,
      data.buyingPrice,
      data.sellingPrice,
      data.averagePrice,
      data.buyingYield,
      data.sellingYield,
      data.averageYield,
      data.dirtyPrice,
      data.excelSource
    ];

    try {
      await db.query(sql, values);
      console.log(`✅ Successfully upserted mark-to-market record for series: ${data.series}`);
    } catch (error) {
      console.error('❌ Error upserting mark-to-market record:', error);
      throw error;
    }
  }

  /**
   * Get all mark-to-market data
   * @returns {Array} Array of mark-to-market records
   */
  async getAllMarkToMarketData() {
    const sql = `
      SELECT 
        series,
        isin_number,
        isin_issuer,
        maturity_date,
        buying_price,
        selling_price,
        average_price,
        buying_yield,
        selling_yield,
        average_yield,
        dirty_price,
        last_updated,
        excel_source
      FROM mark_to_market
      ORDER BY series, last_updated DESC
    `;

    try {
      const [rows] = await db.query(sql);
      console.log(`📊 Retrieved ${rows.length} mark-to-market records`);
      return rows;
    } catch (error) {
      console.error('❌ Error getting mark-to-market data:', error);
      throw error;
    }
  }

  /**
   * Get mark-to-market data for a specific series
   * @param {string} series - Series identifier
   * @returns {Object|null} Mark-to-market record or null if not found
   */
  async getMarkToMarketBySeries(series) {
    const sql = `
      SELECT * FROM mark_to_market 
      WHERE series = ? 
      ORDER BY last_updated DESC 
      LIMIT 1
    `;

    try {
      const [rows] = await db.query(sql, [series]);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error('❌ Error getting mark-to-market by series:', error);
      throw error;
    }
  }

  /**
   * Get summary statistics
   * @returns {Object} Summary statistics
   */
  async getSummaryStatistics() {
    const sql = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT series) as unique_series,
        AVG(average_yield) as avg_yield,
        AVG(average_price) as avg_price,
        MAX(last_updated) as last_update
      FROM mark_to_market
    `;

    try {
      const [rows] = await db.query(sql);
      return rows[0];
    } catch (error) {
      console.error('❌ Error getting summary statistics:', error);
      throw error;
    }
  }

  // Utility functions
  formatDate(date) {
    if (!date) return '';
    if (typeof date === 'string') {
      // Handle ISO date strings like "2015-02-28T18:30:00.000Z"
      if (date.includes('T')) {
        return date.split('T')[0];
      }
      return date;
    }
    return date.toISOString().split('T')[0];
  }

  formatCouponDate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    
    // Use UTC to avoid timezone issues
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${month}-${day}`;
  }
}

module.exports = new MarkToMarketService();
