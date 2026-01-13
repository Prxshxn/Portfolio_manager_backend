const db = require('../config/database');

/**
 * Account Mapping Service
 * 
 * This service provides a centralized way to retrieve account codes for double-entry accounting.
 * Instead of hardcoding account codes throughout the system, we use mapping keys that reference
 * accounts in the chart_of_accounts table.
 * 
 * Usage:
 *   const accountMapping = require('./services/accountMappingService');
 *   const gsecAssetAccount = await accountMapping.getAccountCode('GSEC_ASSET_TBONDS');
 */

// Mapping keys used throughout the system
const MAPPING_KEYS = {
  // GSEC Accounts
  GSEC_ASSET_TBONDS: 'GSEC_ASSET_TBONDS',
  GSEC_DEFAULT_SETTLEMENT: 'GSEC_DEFAULT_SETTLEMENT',
  GSEC_ACCRUAL_ASSET: 'GSEC_ACCRUAL_ASSET',
  GSEC_ACCRUAL_INCOME: 'GSEC_ACCRUAL_INCOME',
  
  // Money Market Accounts
  MM_LENDING_CONTROL: 'MM_LENDING_CONTROL',
  MM_LOAN_LIABILITY: 'MM_LOAN_LIABILITY',
  MM_LENDING_INTEREST_ASSET: 'MM_LENDING_INTEREST_ASSET',
  MM_LENDING_INTEREST_INCOME: 'MM_LENDING_INTEREST_INCOME',
  MM_BORROWING_INTEREST_EXPENSE: 'MM_BORROWING_INTEREST_EXPENSE',
  MM_BORROWING_INTEREST_LIABILITY: 'MM_BORROWING_INTEREST_LIABILITY',
  
  // Maturity Processing Accounts (Pattern-based lookups)
  MATURITY_LIABILITY: 'MATURITY_LIABILITY',
  MATURITY_INTEREST_EXPENSE: 'MATURITY_INTEREST_EXPENSE',
  MATURITY_INTEREST_PAYABLE: 'MATURITY_INTEREST_PAYABLE',
  MATURITY_INTEREST_ACCRUAL: 'MATURITY_INTEREST_ACCRUAL',
  MATURITY_ASSET: 'MATURITY_ASSET',
  MATURITY_INTEREST_RECEIVED: 'MATURITY_INTEREST_RECEIVED',
  MATURITY_INTEREST_RECEIVABLE: 'MATURITY_INTEREST_RECEIVABLE',
  
  // General Accounts
  CASH_BANK_ASSET: 'CASH_BANK_ASSET',
  INCOME_REVENUE: 'INCOME_REVENUE',
  EXPENSE_ACCOUNT: 'EXPENSE_ACCOUNT'
};

// Default account codes (fallback if mapping not found in database)
const DEFAULT_ACCOUNT_CODES = {
  GSEC_ASSET_TBONDS: '1-034-01-01-01',
  GSEC_DEFAULT_SETTLEMENT: '1-666-01-01-01',
  GSEC_ACCRUAL_ASSET: '1-212-01-01-01',
  GSEC_ACCRUAL_INCOME: '3-004-01-01-01',
  MM_LENDING_CONTROL: '1-315-01-01-01',
  MM_LOAN_LIABILITY: '2-708-01-01-01',
  MM_LENDING_INTEREST_ASSET: '1-201-01-01-01',
  MM_LENDING_INTEREST_INCOME: '4-015-01-01-01',
  MM_BORROWING_INTEREST_EXPENSE: '6-288-01-01-01',
  MM_BORROWING_INTEREST_LIABILITY: '2-304-01-01-01'
};

/**
 * Get account code by mapping key
 * @param {string} mappingKey - The mapping key (e.g., 'GSEC_ASSET_TBONDS')
 * @returns {Promise<string>} - The account code
 */
async function getAccountCode(mappingKey) {
  try {
    // First, try to get from account_mappings table
    const [mappings] = await db.query(
      `SELECT account_code FROM account_mappings 
       WHERE mapping_key = ? AND is_active = TRUE 
       LIMIT 1`,
      [mappingKey]
    );
    
    if (mappings && mappings.length > 0) {
      return mappings[0].account_code;
    }
    
    // Fallback to default account codes
    if (DEFAULT_ACCOUNT_CODES[mappingKey]) {
      console.warn(`Using default account code for ${mappingKey}: ${DEFAULT_ACCOUNT_CODES[mappingKey]}`);
      return DEFAULT_ACCOUNT_CODES[mappingKey];
    }
    
    throw new Error(`Account mapping not found for key: ${mappingKey}`);
  } catch (error) {
    console.error(`Error getting account code for ${mappingKey}:`, error);
    // Final fallback to default
    if (DEFAULT_ACCOUNT_CODES[mappingKey]) {
      return DEFAULT_ACCOUNT_CODES[mappingKey];
    }
    throw error;
  }
}

/**
 * Get account ID by mapping key
 * @param {string} mappingKey - The mapping key
 * @returns {Promise<number>} - The account ID
 */
async function getAccountId(mappingKey) {
  const accountCode = await getAccountCode(mappingKey);
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [accountCode]
  );
  
  if (rows.length === 0) {
    throw new Error(`Account not found in chart_of_accounts for code: ${accountCode} (mapping: ${mappingKey})`);
  }
  
  return rows[0].id;
}

/**
 * Get account code by pattern (for dynamic lookups)
 * @param {string} pattern - SQL pattern (e.g., "account_code LIKE '1%' AND name LIKE '%asset%'")
 * @returns {Promise<string|null>} - The account code or null if not found
 */
async function getAccountCodeByPattern(pattern) {
  try {
    const [rows] = await db.query(
      `SELECT account_code FROM chart_of_accounts 
       WHERE ${pattern} AND is_active = TRUE 
       LIMIT 1`
    );
    
    if (rows && rows.length > 0) {
      return rows[0].account_code;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting account code by pattern ${pattern}:`, error);
    return null;
  }
}

/**
 * Get account ID by pattern
 * @param {string} pattern - SQL pattern
 * @returns {Promise<number|null>} - The account ID or null if not found
 */
async function getAccountIdByPattern(pattern) {
  try {
    const [rows] = await db.query(
      `SELECT id FROM chart_of_accounts 
       WHERE ${pattern} AND is_active = TRUE 
       LIMIT 1`
    );
    
    if (rows && rows.length > 0) {
      return rows[0].id;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting account ID by pattern ${pattern}:`, error);
    return null;
  }
}

/**
 * Set account mapping (for configuration)
 * @param {string} mappingKey - The mapping key
 * @param {string} accountCode - The account code to map
 * @returns {Promise<void>}
 */
async function setAccountMapping(mappingKey, accountCode, description = null) {
  try {
    // Verify account exists
    const [accounts] = await db.query(
      'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
      [accountCode]
    );
    
    if (accounts.length === 0) {
      throw new Error(`Account code ${accountCode} does not exist in chart_of_accounts`);
    }
    
    // Insert or update mapping
    await db.query(
      `INSERT INTO account_mappings (mapping_key, account_code, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, TRUE, NOW(), NOW())
       ON DUPLICATE KEY UPDATE 
         account_code = VALUES(account_code),
         description = VALUES(description),
         updated_at = NOW()`,
      [mappingKey, accountCode, description]
    );
    
    console.log(`Account mapping updated: ${mappingKey} -> ${accountCode}`);
  } catch (error) {
    console.error(`Error setting account mapping for ${mappingKey}:`, error);
    throw error;
  }
}

/**
 * Get all account mappings
 * @returns {Promise<Array>} - Array of mapping objects
 */
async function getAllMappings() {
  try {
    const [mappings] = await db.query(
      `SELECT am.*, coa.name as account_name, coa.account_code
       FROM account_mappings am
       JOIN chart_of_accounts coa ON am.account_code = coa.account_code
       WHERE am.is_active = TRUE
       ORDER BY am.mapping_key`
    );
    
    return mappings;
  } catch (error) {
    console.error('Error getting all account mappings:', error);
    return [];
  }
}

module.exports = {
  MAPPING_KEYS,
  getAccountCode,
  getAccountId,
  getAccountCodeByPattern,
  getAccountIdByPattern,
  setAccountMapping,
  getAllMappings
};
