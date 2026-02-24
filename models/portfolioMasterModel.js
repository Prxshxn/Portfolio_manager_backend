const db = require('../config/db');

class PortfolioMaster {
  static async getAll() {
    const [rows] = await db.query('SELECT * FROM portfolio_master');
    return rows;
  }

  static async getById(id) {
    const [rows] = await db.query('SELECT * FROM portfolio_master WHERE portfolio_id = ?', [id]);
    return rows[0];
  }

  static async create(data) {
    // Convert empty strings to null for optional fields
    const cleanValue = (val) => (val === '' || val === null || val === undefined ? null : val);
    
    // Handle date fields - convert empty strings to null
    data.start_date = cleanValue(data.start_date);
    data.end_date = cleanValue(data.end_date);
    
    // Handle parent_portfolio_id
    data.parent_portfolio_id = cleanValue(data.parent_portfolio_id);
    
    // Handle other optional string fields that should be null instead of empty
    data.benchmark = cleanValue(data.benchmark);
    data.compliance_rules_id = cleanValue(data.compliance_rules_id);
    data.notes_description = cleanValue(data.notes_description);
    data.valuation_method = cleanValue(data.valuation_method);
    data.accounting_treatment = cleanValue(data.accounting_treatment);
    data.rebalancing_frequency = cleanValue(data.rebalancing_frequency);
    data.external_reference_code = cleanValue(data.external_reference_code);
    data.tags_categories = cleanValue(data.tags_categories);
    
    const [result] = await db.query('INSERT INTO portfolio_master SET ?', [data]);
    return { ...data, portfolio_id: data.portfolio_id };
  }

  static async update(id, data) {
    // Convert empty strings to null for optional fields (same as create)
    const cleanValue = (val) => (val === '' || val === null || val === undefined ? null : val);
    
    // Handle date fields - convert empty strings to null
    if (data.start_date !== undefined) data.start_date = cleanValue(data.start_date);
    if (data.end_date !== undefined) data.end_date = cleanValue(data.end_date);
    
    // Handle parent_portfolio_id
    if (data.parent_portfolio_id !== undefined) data.parent_portfolio_id = cleanValue(data.parent_portfolio_id);
    
    // Handle other optional string fields
    if (data.benchmark !== undefined) data.benchmark = cleanValue(data.benchmark);
    if (data.compliance_rules_id !== undefined) data.compliance_rules_id = cleanValue(data.compliance_rules_id);
    if (data.notes_description !== undefined) data.notes_description = cleanValue(data.notes_description);
    if (data.valuation_method !== undefined) data.valuation_method = cleanValue(data.valuation_method);
    if (data.accounting_treatment !== undefined) data.accounting_treatment = cleanValue(data.accounting_treatment);
    if (data.rebalancing_frequency !== undefined) data.rebalancing_frequency = cleanValue(data.rebalancing_frequency);
    if (data.external_reference_code !== undefined) data.external_reference_code = cleanValue(data.external_reference_code);
    if (data.tags_categories !== undefined) data.tags_categories = cleanValue(data.tags_categories);
    
    await db.query('UPDATE portfolio_master SET ? WHERE portfolio_id = ?', [data, id]);
    return { ...data, portfolio_id: id };
  }

  static async delete(id) {
    await db.query('DELETE FROM portfolio_master WHERE portfolio_id = ?', [id]);
    return true;
  }
}

module.exports = PortfolioMaster;
