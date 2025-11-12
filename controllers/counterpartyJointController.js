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
