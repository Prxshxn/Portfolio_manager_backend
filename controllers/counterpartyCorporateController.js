const CounterpartyCorporate = require('../models/counterpartyCorporateModel');

exports.createCounterpartyCorporate = async (req, res) => {
  try {
    const result = await CounterpartyCorporate.create(req.body);
    res.status(201).json({ 
      id: result.insertId, 
      cux_number: result.cux_number,
      ...req.body 
    });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getAllCounterpartyCorporates = async (req, res) => {
  try {
    const results = await CounterpartyCorporate.getAll();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};
