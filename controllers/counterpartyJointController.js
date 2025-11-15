const CounterpartyJoint = require('../models/counterpartyJointModel');

exports.createCounterpartyJoint = async (req, res) => {
  try {
    const result = await CounterpartyJoint.create(req.body);
    res.status(201).json({ 
      id: result.insertId, 
      cux_number: result.cux_number,
      ...req.body 
    });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getAllCounterpartyJoints = async (req, res) => {
  try {
    const results = await CounterpartyJoint.getAll();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getCounterpartyJointById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyJoint.getById(id);
    if (!result) {
      return res.status(404).json({ error: 'Counterparty not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.updateCounterpartyJoint = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyJoint.update(id, req.body);
    res.json({ success: true, message: 'Counterparty updated successfully', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};
