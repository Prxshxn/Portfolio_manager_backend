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
    // Check if error is about duplicate NIC
    if (err.message && err.message.includes('NIC number already exists')) {
      return res.status(400).json({ 
        error: err.message,
        success: false 
      });
    }
    // Check for MySQL duplicate entry error
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      return res.status(400).json({ 
        error: 'NIC number already exists. Please use a different NIC number.',
        success: false 
      });
    }
    res.status(500).json({ error: err.message || err, success: false });
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
    // Check if error is about duplicate NIC
    if (err.message && err.message.includes('NIC number already exists')) {
      return res.status(400).json({ 
        error: err.message,
        success: false 
      });
    }
    // Check for MySQL duplicate entry error
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      return res.status(400).json({ 
        error: 'NIC number already exists. Please use a different NIC number.',
        success: false 
      });
    }
    res.status(500).json({ error: err.message || err, success: false });
  }
};
