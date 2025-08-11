const Counterparty = require('../models/counterpartyModel');

exports.getAllCounterparties = async (req, res) => {
  try {
    const results = await Counterparty.getAll();
    res.json({ data: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCounterpartyById = async (req, res) => {
  try {
    const result = await Counterparty.getById(req.params.id);
    if (!result) return res.status(404).json({ error: 'Counterparty not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


