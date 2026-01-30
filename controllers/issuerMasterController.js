const IssuerMaster = require('../models/issuerMasterModel');

exports.getAllIssuers = async (req, res) => {
  try {
    const issuers = await IssuerMaster.getAll();
    res.json(issuers);
  } catch (error) {
    console.error('Error fetching issuers:', error);
    res.status(500).json({ error: 'Failed to fetch issuers' });
  }
};

exports.getIssuerById = async (req, res) => {
  try {
    const issuer = await IssuerMaster.getById(req.params.id);
    if (!issuer) {
      return res.status(404).json({ error: 'Issuer not found' });
    }
    res.json(issuer);
  } catch (error) {
    console.error('Error fetching issuer:', error);
    res.status(500).json({ error: 'Failed to fetch issuer' });
  }
};

exports.createIssuer = async (req, res) => {
  try {
    const issuer = await IssuerMaster.create(req.body);
    res.status(201).json(issuer);
  } catch (error) {
    console.error('Error creating issuer:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Issuer ID already exists' });
    }
    res.status(500).json({ error: 'Failed to create issuer' });
  }
};

exports.updateIssuer = async (req, res) => {
  try {
    const id = req.params.id;
    console.log('Updating issuer with ID:', id);
    console.log('Update data:', req.body);
    
    await IssuerMaster.update(id, req.body);
    const updatedIssuer = await IssuerMaster.getById(id);
    
    if (!updatedIssuer) {
      return res.status(404).json({ error: 'Issuer not found after update' });
    }
    
    res.json(updatedIssuer);
  } catch (error) {
    console.error('Error updating issuer:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage
    });
    res.status(500).json({ 
      error: 'Failed to update issuer',
      details: error.message 
    });
  }
};

exports.deleteIssuer = async (req, res) => {
  try {
    await IssuerMaster.delete(req.params.id);
    res.json({ success: true, message: 'Issuer deleted successfully' });
  } catch (error) {
    console.error('Error deleting issuer:', error);
    res.status(500).json({ error: 'Failed to delete issuer' });
  }
};
