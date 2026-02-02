const fundCentreMasterService = require('../services/fundCentreMasterService');

/**
 * GET /api/fund-centre-master
 * Get all fund centres
 */
exports.getAllFundCentres = async (req, res) => {
  try {
    const fundCentres = await fundCentreMasterService.getAllFundCentres();
    res.json({
      success: true,
      data: fundCentres
    });
  } catch (error) {
    console.error('Error fetching fund centres:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch fund centres'
    });
  }
};

/**
 * GET /api/fund-centre-master/:id
 * Get fund centre by ID
 */
exports.getFundCentreById = async (req, res) => {
  try {
    const { id } = req.params;
    const fundCentre = await fundCentreMasterService.getFundCentreById(id);
    res.json({
      success: true,
      data: fundCentre
    });
  } catch (error) {
    console.error('Error fetching fund centre:', error);
    res.status(error.message === 'Fund centre not found' ? 404 : 500).json({
      success: false,
      error: error.message || 'Failed to fetch fund centre'
    });
  }
};

/**
 * POST /api/fund-centre-master
 * Create a new fund centre
 */
exports.createFundCentre = async (req, res) => {
  try {
    const { name, fund_centre_code, country, gmt_timezone, currency, city, iana_timezone, latitude, longitude, dst_observed } = req.body;

    if (!name || !fund_centre_code || !country || !gmt_timezone || !currency) {
      return res.status(400).json({
        success: false,
        error: 'All required fields are missing'
      });
    }

    const fundCentre = await fundCentreMasterService.createFundCentre({
      name,
      fund_centre_code,
      country,
      gmt_timezone,
      currency,
      city,
      iana_timezone,
      latitude,
      longitude,
      dst_observed
    });

    res.status(201).json({
      success: true,
      data: fundCentre,
      message: 'Fund centre created successfully'
    });
  } catch (error) {
    console.error('Error creating fund centre:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create fund centre'
    });
  }
};

/**
 * PUT /api/fund-centre-master/:id
 * Update a fund centre
 */
exports.updateFundCentre = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, fund_centre_code, country, gmt_timezone, currency, city, iana_timezone, latitude, longitude, dst_observed } = req.body;

    if (!name || !fund_centre_code || !country || !gmt_timezone || !currency) {
      return res.status(400).json({
        success: false,
        error: 'All required fields are missing'
      });
    }

    const fundCentre = await fundCentreMasterService.updateFundCentre(id, {
      name,
      fund_centre_code,
      country,
      gmt_timezone,
      currency,
      city,
      iana_timezone,
      latitude,
      longitude,
      dst_observed
    });

    res.json({
      success: true,
      data: fundCentre,
      message: 'Fund centre updated successfully'
    });
  } catch (error) {
    console.error('Error updating fund centre:', error);
    const statusCode = error.message === 'Fund centre not found' ? 404 : 400;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to update fund centre'
    });
  }
};

/**
 * DELETE /api/fund-centre-master/:id
 * Delete a fund centre
 */
exports.deleteFundCentre = async (req, res) => {
  try {
    const { id } = req.params;
    await fundCentreMasterService.deleteFundCentre(id);
    res.json({
      success: true,
      message: 'Fund centre deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting fund centre:', error);
    const statusCode = error.message === 'Fund centre not found' ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to delete fund centre'
    });
  }
};

/**
 * GET /api/fund-centre-master/dropdown/list
 * Get fund centres for dropdown (id, name, fund_centre_code)
 */
exports.getFundCentresForDropdown = async (req, res) => {
  try {
    const fundCentres = await fundCentreMasterService.getAllFundCentres();
    // Return only id, name, and fund_centre_code for dropdown
    const dropdownData = fundCentres.map(fc => ({
      id: fc.id,
      name: fc.name,
      fund_centre_code: fc.fund_centre_code
    }));
    res.json({
      success: true,
      data: dropdownData
    });
  } catch (error) {
    console.error('Error fetching fund centres for dropdown:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch fund centres'
    });
  }
};