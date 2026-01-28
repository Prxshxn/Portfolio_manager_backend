const InvestmentApproverMaster = require('../models/investmentApproverMasterModel');

exports.getAllApprovers = async (req, res) => {
  try {
    const approvers = await InvestmentApproverMaster.getAll();
    res.json(approvers);
  } catch (error) {
    console.error('Error fetching investment approvers:', error);
    res.status(500).json({ error: 'Failed to fetch investment approvers' });
  }
};

exports.getApproverById = async (req, res) => {
  try {
    const approver = await InvestmentApproverMaster.getById(req.params.id);
    if (!approver) {
      return res.status(404).json({ error: 'Investment approver not found' });
    }
    res.json(approver);
  } catch (error) {
    console.error('Error fetching investment approver:', error);
    res.status(500).json({ error: 'Failed to fetch investment approver' });
  }
};

exports.createApprover = async (req, res) => {
  try {
    const approver = await InvestmentApproverMaster.create(req.body);
    res.status(201).json(approver);
  } catch (error) {
    console.error('Error creating investment approver:', error);
    res.status(500).json({ error: 'Failed to create investment approver' });
  }
};

exports.updateApprover = async (req, res) => {
  try {
    await InvestmentApproverMaster.update(req.params.id, req.body);
    const updated = await InvestmentApproverMaster.getById(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Error updating investment approver:', error);
    res.status(500).json({ error: 'Failed to update investment approver' });
  }
};

exports.deleteApprover = async (req, res) => {
  try {
    await InvestmentApproverMaster.delete(req.params.id);
    res.json({ success: true, message: 'Investment approver deleted successfully' });
  } catch (error) {
    console.error('Error deleting investment approver:', error);
    res.status(500).json({ error: 'Failed to delete investment approver' });
  }
};

