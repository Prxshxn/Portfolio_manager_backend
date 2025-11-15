const CounterpartyIndividual = require('../models/counterpartyIndividualModel');

exports.createCounterpartyIndividual = async (req, res) => {
  try {
    const result = await CounterpartyIndividual.create(req.body);
    res.status(201).json({ 
      id: result.insertId, 
      cux_number: result.cux_number,
      ...req.body 
    });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getAllCounterpartyIndividuals = async (req, res) => {
  try {
    const results = await CounterpartyIndividual.getAll();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getCounterpartyIndividualById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyIndividual.getById(id);
    if (!result) {
      return res.status(404).json({ error: 'Counterparty not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.updateCounterpartyIndividual = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyIndividual.update(id, req.body);
    res.json({ success: true, message: 'Counterparty updated successfully', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};
