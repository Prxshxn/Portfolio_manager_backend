const express = require('express');
const router = express.Router();
const db = require('../models/gsec'); // Adjust if your DB/model import is different

// GET /api/gsec?approval_level=1 - fetch all GSec transactions at a given approval level
// GET /api/gsec?approval_level=1 - fetch all GSec transactions at a given approval level
router.get('/', async (req, res) => {
  const { portfolio, approval_level } = req.query;
  try {
    let transactions;
    if (portfolio) {
      transactions = await db.getTransactionsByPortfolio(portfolio);
    } else if (approval_level) {
      transactions = await db.getTransactionsByApprovalLevel(approval_level);
    } else {
      transactions = await db.getAllTransactions(); // fallback, or return []
    }
    res.json(transactions);
  } catch (err) {
    console.error('Error fetching GSec transactions:', err);
    res.status(500).json({ error: 'Failed to fetch GSec transactions' });
  }
});

// POST /api/gsec/:id/approve - advance approval level for a transaction
router.post('/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const updatedTx = await db.advanceApprovalLevel(id);
    if (!updatedTx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(updatedTx);
  } catch (err) {
    console.error('Error approving GSec transaction:', err);
    res.status(500).json({ error: 'Failed to approve transaction' });
  }
});

// GET /api/gsec/buy-deals - fetch only the Buy deals
router.get('/buy-deals', async (req, res) => {
  try {
    const deals = await db.getBuyDeals();
    res.json({ success: true, data: deals });
  } catch (err) {
    console.error('Error fetching Buy GSec deals:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch Buy GSec deals' });
  }
});

// GET /api/gsec/buy-deals-with-balance - fetch Buy deals with remaining face value
router.get('/buy-deals-with-balance', async (req, res) => {
  try {
    const deals = await db.getBuyDealsWithBalance();
    res.json({ success: true, data: deals });
  } catch (err) {
    console.error('Error fetching Buy GSec deals with balance:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch Buy GSec deals with balance' });
  }
});

module.exports = router;
