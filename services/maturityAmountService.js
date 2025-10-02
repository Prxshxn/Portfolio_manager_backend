const db = require('../config/database');

/**
 * Maturity Amount Service
 * Calculates maturity amounts for different product types following industry best practices
 */
class MaturityAmountService {
  
  /**
   * Calculate maturity amount for Money Market deals
   * Formula: Principal + (Principal × Rate × Days / 365)
   */
  static async calculateMoneyMarketMaturityAmount(dealId, processDate) {
    try {
      const query = `
        SELECT 
          id,
          deal_number,
          principal_amount,
          interest_rate,
          maturity_date,
          counterparty_id,
          COALESCE(corp.short_name, ind.short_name, joint.short_name, mmd.counterparty_id) as counterparty_name
        FROM money_market_deals mmd
        LEFT JOIN counterparty_master_corporate corp ON mmd.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON mmd.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON mmd.counterparty_id = joint.id
        WHERE mmd.id = ?
      `;
      
      const [rows] = await db.query(query, [dealId]);
      if (rows.length === 0) return null;
      
      const deal = rows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestRate = parseFloat(deal.interest_rate) / 100;
      
      // Calculate days from process date to maturity date
      const processDateObj = new Date(processDate);
      const maturityDateObj = new Date(deal.maturity_date);
      const daysToMaturity = Math.ceil((maturityDateObj - processDateObj) / (1000 * 60 * 60 * 24));
      
      // Calculate interest amount
      const interestAmount = (principalAmount * interestRate * daysToMaturity) / 365;
      const maturityAmount = principalAmount + interestAmount;
      
      return {
        deal_id: deal.id,
        deal_number: deal.deal_number,
        product_type: 'money_market',
        principal_amount: principalAmount,
        interest_amount: interestAmount,
        maturity_amount: maturityAmount,
        interest_rate: deal.interest_rate,
        maturity_date: deal.maturity_date,
        days_to_maturity: daysToMaturity,
        counterparty_name: deal.counterparty_name
      };
    } catch (error) {
      console.error('Error calculating Money Market maturity amount:', error);
      throw error;
    }
  }
  
  /**
   * Calculate maturity amount for Repo deals
   * Formula: Principal + Interest (already calculated in repo_deals table)
   */
  static async calculateRepoMaturityAmount(dealId, processDate) {
    try {
      const query = `
        SELECT 
          rd.id,
          rd.deal_number,
          rd.principal_amount,
          rd.interest_amount,
          rd.maturity_amount,
          rd.rate,
          rd.maturity_date,
          rd.counterparty_id,
          COALESCE(corp.short_name, ind.short_name, joint.short_name, rd.counterparty_id) as counterparty_name
        FROM repo_deals rd
        LEFT JOIN counterparty_master_corporate corp ON rd.counterparty_id = corp.id
        LEFT JOIN counterparty_master_individual ind ON rd.counterparty_id = ind.id
        LEFT JOIN counterparty_master_joint joint ON rd.counterparty_id = joint.id
        WHERE rd.id = ?
      `;
      
      const [rows] = await db.query(query, [dealId]);
      if (rows.length === 0) return null;
      
      const deal = rows[0];
      const principalAmount = parseFloat(deal.principal_amount);
      const interestAmount = parseFloat(deal.interest_amount);
      const maturityAmount = parseFloat(deal.maturity_amount) || (principalAmount + interestAmount);
      
      return {
        deal_id: deal.id,
        deal_number: deal.deal_number,
        product_type: 'repo',
        principal_amount: principalAmount,
        interest_amount: interestAmount,
        maturity_amount: maturityAmount,
        interest_rate: deal.rate,
        maturity_date: deal.maturity_date,
        counterparty_name: deal.counterparty_name
      };
    } catch (error) {
      console.error('Error calculating Repo maturity amount:', error);
      throw error;
    }
  }
  
  /**
   * Calculate maturity amount for GSEC deals
   * Formula: Settlement Amount (already calculated in gsec table)
   */
  static async calculateGsecMaturityAmount(dealId, processDate) {
    try {
      const query = `
        SELECT 
          g.id,
          g.deal_number,
          g.face_value,
          g.settlement_amount,
          g.accrued_interest,
          g.yield,
          g.maturity_date,
          g.counterparty,
          g.isin
        FROM gsec g
        WHERE g.id = ?
      `;
      
      const [rows] = await db.query(query, [dealId]);
      if (rows.length === 0) return null;
      
      const deal = rows[0];
      const faceValue = parseFloat(deal.face_value);
      const settlementAmount = parseFloat(deal.settlement_amount);
      const accruedInterest = parseFloat(deal.accrued_interest) || 0;
      
      // For GSEC, settlement amount is the maturity amount
      const maturityAmount = settlementAmount;
      
      return {
        deal_id: deal.id,
        deal_number: deal.deal_number,
        product_type: 'gsec',
        face_value: faceValue,
        settlement_amount: settlementAmount,
        maturity_amount: maturityAmount,
        accrued_interest: accruedInterest,
        yield: deal.yield,
        maturity_date: deal.maturity_date,
        isin: deal.isin,
        counterparty_name: deal.counterparty
      };
    } catch (error) {
      console.error('Error calculating GSEC maturity amount:', error);
      throw error;
    }
  }
  
  /**
   * Get maturity amounts for multiple deals
   * Automatically detects product type and calculates appropriate maturity amount
   */
  static async getMaturityAmounts(dealIds, processDate) {
    try {
      const results = [];
      
      for (const dealId of dealIds) {
        // Try each product type to find the deal
        let maturityData = await this.calculateMoneyMarketMaturityAmount(dealId, processDate);
        
        if (!maturityData) {
          maturityData = await this.calculateRepoMaturityAmount(dealId, processDate);
        }
        
        if (!maturityData) {
          maturityData = await this.calculateGsecMaturityAmount(dealId, processDate);
        }
        
        if (maturityData) {
          results.push(maturityData);
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error getting maturity amounts:', error);
      throw error;
    }
  }
  
  /**
   * Get maturity amounts for deals in processing log
   * Enhanced version that includes maturity amounts in blotter data
   */
  static async getMaturityBlotterWithAmounts(dealIds, processDate) {
    try {
      const maturityAmounts = await this.getMaturityAmounts(dealIds, processDate);
      
      // Create a map for quick lookup
      const amountMap = {};
      maturityAmounts.forEach(amount => {
        amountMap[amount.deal_id] = amount;
      });
      
      return amountMap;
    } catch (error) {
      console.error('Error getting maturity blotter with amounts:', error);
      throw error;
    }
  }
}

module.exports = MaturityAmountService;
