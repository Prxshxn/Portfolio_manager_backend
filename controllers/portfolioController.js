const PortfolioMaster = require('../models/portfolioMasterModel');

exports.getAllPortfolios = async (req, res) => {
  try {
    const portfolios = await PortfolioMaster.getAll();
    // Only return id and name
    const result = portfolios.map(p => ({
      id: p.portfolio_id,
      name: p.portfolio_name
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch portfolios' });
  }
};
