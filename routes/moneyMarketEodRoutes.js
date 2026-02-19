const express = require('express');
const router = express.Router();
const { getAllDeals } = require('../models/moneyMarketDealModel');
const { getSystemDay, setSystemDay } = require('../models/systemDayModel');
const { checkAuth, checkAdmin } = require('../middleware/auth');
const accountMapping = require('../services/accountMappingService');
// You may need to adjust this path to your ledger posting API
const postLedgerEntry = require('../controllers/ledgerController').postLedgerEntry;
console.log ("started eod page");

// POST /api/money-market/ledger-post
router.post('/ledger-post', checkAuth, checkAdmin, async (req, res) => {
  try {
    console.log('Ledger posting endpoint called');
    const systemDayObj = await getSystemDay();
    if (!systemDayObj) return res.status(400).json({ success: false, message: 'System day not set.' });
    const systemDay = systemDayObj.system_date;
    const deals = await getAllDeals();
    console.log('Deals to process for ledger post:', deals.length);
    let postedCount = 0;
    for (const deal of deals) {
      const amount = Number(deal.per_day_interest);
      if (isNaN(amount)) {
        console.warn('Skipping deal due to invalid per_day_interest:', deal.id, deal.per_day_interest);
        continue;
      }
      console.log('About to post ledger for deal:', deal.id, deal.deal_type, amount, deal);
      if (!deal.deal_type) {
        console.warn(`Skipping deal ${deal.id} due to missing deal_type (null or undefined).`);
        continue;
      }
      const dealTypeLower = deal.deal_type.toLowerCase();
      if (dealTypeLower === 'lending') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_ASSET);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_INCOME);
        await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily lending interest EOD',
        });
      } else if (deal.deal_type === 'borrowing') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_EXPENSE);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_LIABILITY);
        await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily borrowing interest EOD',
        });
      }
      postedCount++;
    }
    res.json({ success: true, message: `Ledger posted for ${postedCount} deals.` });
  } catch (err) {
    console.error('Ledger posting error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/money-market/eod
router.post('/eod', checkAuth, checkAdmin, async (req, res) => {
  try {
    console.log('EOD endpoint called');
    const systemDayObj = await getSystemDay();
    if (!systemDayObj) return res.status(400).json({ success: false, message: 'System day not set.' });
    const systemDay = systemDayObj.system_date;
    const deals = await getAllDeals();
    console.log('Deals to process:', deals.length);
    let postedCount = 0;
    for (const deal of deals) {
      let amount = Number(deal.per_day_interest);
      if (isNaN(amount) || amount === undefined) {
        // Fallback for legacy typo field
        amount = Number(deal.per_day_intrest);
        if (!isNaN(amount)) {
          console.warn(`Deal ${deal.id}: Used fallback field 'per_day_intrest' (please fix data schema).`);
        } else {
          console.warn(`Deal ${deal.id}: Missing or invalid 'per_day_interest' and 'per_day_intrest'. Skipping ledger posting for this deal.`);
          continue;
        }
      }
      if (!deal.deal_type) {
        console.warn(`Skipping deal ${deal.id} due to missing deal_type (null or undefined).`);
        continue;
      }
      const dealTypeLower = deal.deal_type.toLowerCase();
      if (dealTypeLower === 'lending') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_ASSET);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_INCOME);
        await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily lending interest EOD',
        });
      } else if (deal.deal_type === 'borrowing') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_EXPENSE);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_LIABILITY);
        await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily borrowing interest EOD',
        });
      }
      
      postedCount++;
    }
    // GSec per-day accrual posting
    console.log('--- GSec EOD posting block reached ---');
    const db = require('../config/database');
    const [gsecDeals] = await db.query(
      `SELECT id, deal_number, per_day_accrual, maturity_date FROM gsec WHERE per_day_accrual IS NOT NULL AND per_day_accrual > 0 AND maturity_date >= ?`,
      [systemDay]
    );
    console.log('GSec deals to post:', gsecDeals.length, gsecDeals);
    let gsecPostedCount = 0;
    for (const deal of gsecDeals) {
      try {
        const amount = Number(deal.per_day_accrual);
        if (isNaN(amount) || amount === 0) {
          console.warn('Skipping GSec deal due to invalid per_day_accrual:', deal.deal_number, deal.per_day_accrual);
          continue;
        }
        console.log('Posting GSec ledger for deal:', deal.deal_number, amount);
        const accountMapping = require('../services/accountMappingService');
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);
        await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.deal_number,
          description: `GSec Daily Accrual for Deal ${deal.deal_number}`
        });
        gsecPostedCount++;
      } catch (err) {
        console.error('Failed to post GSec ledger for deal:', deal.deal_number, err);
      }
    }

    // Fixed Deposit per-day accrual posting
    console.log('--- Fixed Deposit EOD posting block reached ---');
    const [fdDeals] = await db.query(
      `SELECT id, request_no, daily_accrual, maturity_date FROM fixed_deposit_requests 
       WHERE status = 'Approved' AND daily_accrual IS NOT NULL AND daily_accrual > 0 AND maturity_date >= ?`,
      [systemDay]
    );
    console.log('Fixed Deposit deals to post:', fdDeals.length);
    let fdPostedCount = 0;
    for (const deal of fdDeals) {
      try {
        const amount = Number(deal.daily_accrual);
        if (isNaN(amount) || amount === 0) {
          console.warn('Skipping FD request due to invalid daily_accrual:', deal.request_no, deal.daily_accrual);
          continue;
        }
        console.log('Posting FD ledger for request:', deal.request_no, amount);
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.FD_ACCRUAL_ASSET);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.FD_ACCRUAL_INCOME);
        await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.request_no,
          description: `Fixed Deposit Daily Accrual for Request ${deal.request_no}`
        });
        fdPostedCount++;
      } catch (err) {
        console.error('Failed to post FD ledger for request:', deal.request_no, err);
      }
    }

    // Advance system day
    const nextDay = new Date(systemDay);
    nextDay.setDate(nextDay.getDate() + 1);
    await setSystemDay(nextDay.toISOString().slice(0, 10));
    res.json({ success: true, message: `EOD complete. Posted for ${postedCount} money market deals, ${gsecPostedCount} GSec deals, and ${fdPostedCount} fixed deposit deals.`, next_system_day: nextDay.toISOString().slice(0, 10) });
  } catch (err) {
    console.error('EOD error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/money-market/daily-interest
router.get('/daily-interest', checkAuth, async (req, res) => {
  try {
    const deals = await getAllDeals();
    res.json({ success: true, deals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;