const fundCentreMasterModel = require('../models/fundCentreMasterModel');

/**
 * Get all fund centres
 */
exports.getAllFundCentres = async () => {
  try {
    return await fundCentreMasterModel.getAllFundCentres();
  } catch (error) {
    console.error('Error fetching fund centres:', error);
    throw error;
  }
};

/**
 * Get fund centre by ID
 */
exports.getFundCentreById = async (id) => {
  try {
    const fundCentre = await fundCentreMasterModel.getFundCentreById(id);
    if (!fundCentre) {
      throw new Error('Fund centre not found');
    }
    return fundCentre;
  } catch (error) {
    console.error('Error fetching fund centre:', error);
    throw error;
  }
};

/**
 * Create a new fund centre
 */
exports.createFundCentre = async (fundCentreData) => {
  try {
    const { name, fund_centre_code, country, gmt_timezone, currency } = fundCentreData;

    // Validation
    if (!name || !fund_centre_code || !country || !gmt_timezone || !currency) {
      throw new Error('All fields are required');
    }

    // Validate fund centre code format (should start with FC)
    if (!fund_centre_code.startsWith('FC')) {
      throw new Error('Fund centre code must start with "FC"');
    }

    // Check if fund centre code already exists
    const existing = await fundCentreMasterModel.getFundCentreByCode(fund_centre_code);
    if (existing) {
      throw new Error('Fund centre code already exists');
    }

    // Check if currency already exists for another fund centre
    const existingCurrency = await fundCentreMasterModel.getFundCentreByCurrency(currency);
    if (existingCurrency) {
      throw new Error(`Currency ${currency} is already assigned to fund centre "${existingCurrency.name}" (${existingCurrency.fund_centre_code}). Each currency can only be assigned to one fund centre.`);
    }

    const id = await fundCentreMasterModel.createFundCentre({
      name,
      fund_centre_code,
      country,
      gmt_timezone,
      currency
    });

    return await fundCentreMasterModel.getFundCentreById(id);
  } catch (error) {
    console.error('Error creating fund centre:', error);
    throw error;
  }
};

/**
 * Update a fund centre
 */
exports.updateFundCentre = async (id, fundCentreData) => {
  try {
    const { name, fund_centre_code, country, gmt_timezone, currency } = fundCentreData;

    // Validation
    if (!name || !fund_centre_code || !country || !gmt_timezone || !currency) {
      throw new Error('All fields are required');
    }

    // Validate fund centre code format (should start with FC)
    if (!fund_centre_code.startsWith('FC')) {
      throw new Error('Fund centre code must start with "FC"');
    }

    // Check if fund centre exists
    const existing = await fundCentreMasterModel.getFundCentreById(id);
    if (!existing) {
      throw new Error('Fund centre not found');
    }

    // Check if another fund centre exists with this code (excluding current)
    const codeFundCentre = await fundCentreMasterModel.getFundCentreByCode(fund_centre_code);
    if (codeFundCentre && codeFundCentre.id !== id) {
      throw new Error('Fund centre code already exists');
    }

    // Check if currency already exists for another fund centre (excluding current)
    const existingCurrency = await fundCentreMasterModel.getFundCentreByCurrency(currency);
    if (existingCurrency && existingCurrency.id !== id) {
      throw new Error(`Currency ${currency} is already assigned to fund centre "${existingCurrency.name}" (${existingCurrency.fund_centre_code}). Each currency can only be assigned to one fund centre.`);
    }

    const success = await fundCentreMasterModel.updateFundCentre(id, {
      name,
      fund_centre_code,
      country,
      gmt_timezone,
      currency
    });

    if (!success) {
      throw new Error('Failed to update fund centre');
    }

    return await fundCentreMasterModel.getFundCentreById(id);
  } catch (error) {
    console.error('Error updating fund centre:', error);
    throw error;
  }
};

/**
 * Delete a fund centre
 */
exports.deleteFundCentre = async (id) => {
  try {
    const existing = await fundCentreMasterModel.getFundCentreById(id);
    if (!existing) {
      throw new Error('Fund centre not found');
    }

    const success = await fundCentreMasterModel.deleteFundCentre(id);
    if (!success) {
      throw new Error('Failed to delete fund centre');
    }

    return true;
  } catch (error) {
    console.error('Error deleting fund centre:', error);
    throw error;
  }
};
