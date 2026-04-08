const express = require('express');
const router = express.Router();
const { getAllDeals } = require('../models/moneyMarketDealModel');
const { getSystemDay, setSystemDay } = require('../models/systemDayModel');
const { checkAuth, checkAdmin } = require('../middleware/auth');
const accountMapping = require('../services/accountMappingService');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');
// You may need to adjust this path to your ledger posting API
const postLedgerEntry = require('../controllers/ledgerController').postLedgerEntry;
console.log ("started eod page");

/** Calendar-date compare: accrue only when the deal value date is on or before the system (EOD) date. */
function valueDateOnOrBeforeSystemDay(valueDate, systemDay) {
  if (valueDate == null) return false;
  const v = new Date(valueDate);
  const s = new Date(systemDay);
  if (Number.isNaN(v.getTime()) || Number.isNaN(s.getTime())) return false;
  const vUtc = Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
  const sUtc = Date.UTC(s.getFullYear(), s.getMonth(), s.getDate());
  return vUtc <= sUtc;
}

function isLedgerPostOk(result) {
  return result && result.success === true;
}

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
      if (!valueDateOnOrBeforeSystemDay(deal.value_date, systemDay)) {
        console.warn(
          'Skipping MM deal (value date missing or after system date):',
          deal.id,
          'value_date=',
          deal.value_date,
          'systemDay=',
          systemDay
        );
        continue;
      }
      const dealTypeLower = deal.deal_type.toLowerCase();
      if (dealTypeLower === 'lending') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_ASSET);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_INCOME);
        const lr = await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily lending interest EOD',
        });
        if (!isLedgerPostOk(lr)) {
          console.error('MM lending ledger post failed (ledger-post):', deal.id, lr && lr.error);
          continue;
        }
      } else if (deal.deal_type === 'borrowing') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_EXPENSE);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_LIABILITY);
        const lr = await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily borrowing interest EOD',
        });
        if (!isLedgerPostOk(lr)) {
          console.error('MM borrowing ledger post failed (ledger-post):', deal.id, lr && lr.error);
          continue;
        }
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
      if (!valueDateOnOrBeforeSystemDay(deal.value_date, systemDay)) {
        console.warn(
          'Skipping MM deal (value date missing or after system date):',
          deal.id,
          'value_date=',
          deal.value_date,
          'systemDay=',
          systemDay
        );
        continue;
      }
      const dealTypeLower = deal.deal_type.toLowerCase();
      if (dealTypeLower === 'lending') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_ASSET);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_INCOME);
        const lr = await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily lending interest EOD',
        });
        if (!isLedgerPostOk(lr)) {
          console.error('MM lending ledger post failed:', deal.id, lr && lr.error);
          continue;
        }
      } else if (deal.deal_type === 'borrowing') {
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_EXPENSE);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_LIABILITY);
        const lr = await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.id,
          description: 'Daily borrowing interest EOD',
        });
        if (!isLedgerPostOk(lr)) {
          console.error('MM borrowing ledger post failed:', deal.id, lr && lr.error);
          continue;
        }
      }
      
      postedCount++;
    }
    // GSec per-day accrual posting (recalculate from system date + maturity; same E as Excel PRICE)
    console.log('--- GSec EOD posting block reached ---');
    const db = require('../config/database');
    const [gsecDeals] = await db.query(
      `SELECT g.id, g.deal_number, g.value_date, g.coupon_interest, g.maturity_date, g.face_value, g.remaining_face_value,
              g.isin_number, g.per_day_accrual,
              im.coupon_date_1, im.coupon_date_2, im.coupon_rate
       FROM gsec g
       LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
       WHERE g.transaction_type = 'Buy'
         AND g.status = 'final_approved'
         AND g.maturity_date >= ?
         AND g.value_date IS NOT NULL
         AND DATE(g.value_date) <= DATE(?)
         AND (g.coupon_interest IS NOT NULL AND g.coupon_interest > 0
              OR im.coupon_rate IS NOT NULL AND im.coupon_rate > 0)`,
      [systemDay, systemDay]
    );
    console.log('GSec deals to post:', gsecDeals.length, gsecDeals);
    let gsecPostedCount = 0;
    for (const deal of gsecDeals) {
      try {
        // Defense in depth (SQL already filters): value date must be on or before system day
        if (!valueDateOnOrBeforeSystemDay(deal.value_date, systemDay)) {
          console.warn(
            'Skipping GSec deal (value date after system date):',
            deal.deal_number,
            'value_date=',
            deal.value_date,
            'systemDay=',
            systemDay
          );
          if (Number(deal.per_day_accrual) > 0) {
            await db.query('UPDATE gsec SET per_day_accrual = 0 WHERE id = ?', [deal.id]);
          }
          continue;
        }
        const computed = computeGsecPerDayAccrual(deal, systemDay, 2);
        if (!computed.ok) {
          console.warn('Skipping GSec deal:', deal.deal_number, computed.reason);
          // Zero out stale per_day_accrual so it doesn't mislead reports
          if (Number(deal.per_day_accrual) > 0) {
            await db.query('UPDATE gsec SET per_day_accrual = 0 WHERE id = ?', [deal.id]);
          }
          continue;
        }
        const { amount, E } = computed;
        console.log('Posting GSec ledger for deal:', deal.deal_number, amount, 'E=', E, 'isin=', deal.isin_number);
        const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET);
        const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME);
        const lr = await postLedgerEntry({
          date: systemDay,
          dr_account: drAccount,
          cr_account: crAccount,
          amount,
          deal_id: deal.deal_number,
          description: `GSec Daily Accrual for Deal ${deal.deal_number}`
        });
        if (!isLedgerPostOk(lr)) {
          console.error(
            'GSec accrual ledger post failed; gsec row not updated:',
            deal.deal_number,
            lr && lr.error
          );
          continue;
        }
        await db.query(
          `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?`,
          [amount, E, deal.id]
        );
        gsecPostedCount++;
      } catch (err) {
        console.error('Failed to post GSec ledger for deal:', deal.deal_number, err);
      }
    }

    // Clear per_day_accrual for Buy deals whose value date is still in the future (or was posted before this rule)
    await db.query(
      `UPDATE gsec SET per_day_accrual = 0
       WHERE transaction_type = 'Buy'
         AND status = 'final_approved'
         AND value_date IS NOT NULL
         AND DATE(value_date) > DATE(?)
         AND per_day_accrual IS NOT NULL
         AND per_day_accrual <> 0`,
      [systemDay]
    );

    // Zero out stale per_day_accrual on Sell deals (should never accrue)
    await db.query(
      `UPDATE gsec SET per_day_accrual = 0
       WHERE transaction_type = 'Sell' AND per_day_accrual IS NOT NULL AND per_day_accrual > 0`
    );

    // Fixed Deposit per-day accrual posting (temporarily disabled – FD table has no daily_accrual column)
    // console.log('--- Fixed Deposit EOD posting block reached ---');
    // const [fdDeals] = await db.query(
    //   `SELECT id, request_no, daily_accrual, maturity_date FROM fixed_deposit_requests 
    //    WHERE status = 'Approved' AND daily_accrual IS NOT NULL AND daily_accrual > 0 AND maturity_date >= ?`,
    //   [systemDay]
    // );
    // console.log('Fixed Deposit deals to post:', fdDeals.length);
    // let fdPostedCount = 0;
    // for (const deal of fdDeals) {
    //   try {
    //     const amount = Number(deal.daily_accrual);
    //     if (isNaN(amount) || amount === 0) {
    //       console.warn('Skipping FD request due to invalid daily_accrual:', deal.request_no, deal.daily_accrual);
    //       continue;
    //     }
    //     console.log('Posting FD ledger for request:', deal.request_no, amount);
    //     const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.FD_ACCRUAL_ASSET);
    //     const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.FD_ACCRUAL_INCOME);
    //     await postLedgerEntry({
    //       date: systemDay,
    //       dr_account: drAccount,
    //       cr_account: crAccount,
    //       amount,
    //       deal_id: deal.request_no,
    //       description: `Fixed Deposit Daily Accrual for Request ${deal.request_no}`
    //     });
    //     fdPostedCount++;
    //   } catch (err) {
    //     console.error('Failed to post FD ledger for request:', deal.request_no, err);
    //   }
    // }

    // --- Repo Deal EOD Processing ---
    console.log('--- Repo Deal EOD posting block reached ---');
    let repoAccrualCount = 0;
    let repoMaturityCount = 0;
    let repoBackfillCount = 0;
    // Fixed deposit EOD block is currently disabled, so keep count at 0
    const fdPostedCount = 0;

    // Backfill: post purchase entries for final_approved repo deals missing ledger entries
    try {
      const [repoBackfillDeals] = await db.query(
        `SELECT rd.id, rd.deal_type, rd.principal_amount, rd.settlement_mode, rd.value_date
         FROM repo_deals rd
         WHERE rd.approval_status = 'final_approved'
           AND NOT EXISTS (
             SELECT 1 FROM ledger_entries le WHERE le.deal_number = rd.id
           )`
      );
      console.log('Repo deals to backfill:', repoBackfillDeals.length);

      for (const deal of repoBackfillDeals) {
        try {
          let bankAccount = null;
          if (deal.settlement_mode) {
            const [sa] = await db.query(
              'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
              [deal.settlement_mode]
            );
            if (sa && sa.length > 0 && sa[0].ledger_account_code) {
              bankAccount = sa[0].ledger_account_code;
            }
          }
          if (!bankAccount) {
            console.warn(`Skipping backfill for repo deal ${deal.id}: no settlement bank account resolved`);
            continue;
          }
          const valueDate = deal.value_date
            ? new Date(deal.value_date).toISOString().slice(0, 10)
            : systemDay;

          let drAccount;
          let crAccount;
          let description;

          if (deal.deal_type === 'Repo') {
            drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET);
            crAccount = bankAccount;
            description = `Repo Purchase (Backfill) - Deal ${deal.id}`;
          } else if (deal.deal_type === 'Reverse Repo') {
            drAccount = bankAccount;
            crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY);
            description = `Reverse Repo Borrowing (Backfill) - Deal ${deal.id}`;
          } else {
            console.warn(`Skipping backfill for repo deal ${deal.id}: unsupported deal_type=${deal.deal_type}`);
            continue;
          }

          const lr = await postLedgerEntry({
            date: valueDate,
            dr_account: drAccount,
            cr_account: crAccount,
            amount: Number(deal.principal_amount),
            deal_id: String(deal.id),
            description
          });
          if (!isLedgerPostOk(lr)) {
            console.error('Repo backfill ledger post failed:', deal.id, lr && lr.error);
            continue;
          }
          repoBackfillCount++;
        } catch (err) {
          console.error('Failed to backfill repo deal:', deal.id, err);
        }
      }
    } catch (err) {
      console.error('Error in repo backfill block:', err);
    }

    // Daily accrual posting for active repo deals
    try {
      const [repoAccrualDeals] = await db.query(
        `SELECT id, deal_type, daily_accrual, value_date, maturity_date
         FROM repo_deals
         WHERE approval_status = 'final_approved'
           AND daily_accrual IS NOT NULL AND daily_accrual > 0
           AND value_date <= ? AND maturity_date > ?`,
        [systemDay, systemDay]
      );
      console.log('Repo deals for daily accrual:', repoAccrualDeals.length);

      for (const deal of repoAccrualDeals) {
        try {
          const amount = Number(deal.daily_accrual);
          if (isNaN(amount) || amount === 0) continue;

          if (deal.deal_type === 'Repo') {
            const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET);
            const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_INTEREST_INCOME);
            const lr = await postLedgerEntry({
              date: systemDay,
              dr_account: drAccount,
              cr_account: crAccount,
              amount,
              deal_id: String(deal.id),
              description: `Repo Daily Interest Accrual - Deal ${deal.id}`
            });
            if (!isLedgerPostOk(lr)) {
              console.error('Repo accrual ledger post failed:', deal.id, lr && lr.error);
              continue;
            }
            repoAccrualCount++;
          } else if (deal.deal_type === 'Reverse Repo') {
            const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_EXPENSE);
            const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_PAYABLE);
            const lr = await postLedgerEntry({
              date: systemDay,
              dr_account: drAccount,
              cr_account: crAccount,
              amount,
              deal_id: String(deal.id),
              description: `Reverse Repo Daily Interest Accrual - Deal ${deal.id}`
            });
            if (!isLedgerPostOk(lr)) {
              console.error('Reverse repo accrual ledger post failed:', deal.id, lr && lr.error);
              continue;
            }
            repoAccrualCount++;
          }
        } catch (err) {
          console.error('Failed to post repo accrual for deal:', deal.id, err);
        }
      }
    } catch (err) {
      console.error('Error in repo accrual block:', err);
    }

    // Advance system day (compute nextDay early so we can check maturity)
    const nextDay = new Date(systemDay);
    nextDay.setDate(nextDay.getDate() + 1);
    const tomorrowStr = nextDay.toISOString().slice(0, 10);

    // Maturity entries for repo deals maturing tomorrow (day before maturity)
    try {
      const [maturingRepoDeals] = await db.query(
        `SELECT id, deal_type, principal_amount, interest_amount, settlement_mode, maturity_date
         FROM repo_deals
         WHERE approval_status = 'final_approved'
           AND maturity_date = ? AND matured = 0`,
        [tomorrowStr]
      );
      console.log('Repo deals maturing tomorrow:', maturingRepoDeals.length);

      for (const deal of maturingRepoDeals) {
        try {
          let bankAccount = null;
          if (deal.settlement_mode) {
            const [sa] = await db.query(
              'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
              [deal.settlement_mode]
            );
            if (sa && sa.length > 0 && sa[0].ledger_account_code) {
              bankAccount = sa[0].ledger_account_code;
            }
          }
          if (!bankAccount) {
            console.warn(`Skipping maturity entry for repo deal ${deal.id}: no settlement bank account resolved`);
            continue;
          }
          const maturityAmount = Number(deal.principal_amount) + Number(deal.interest_amount);

          let drAccount;
          let crAccount;
          let description;

          if (deal.deal_type === 'Repo') {
            const repoAsset = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET);
            drAccount = bankAccount;
            crAccount = repoAsset;
            description = `Repo Maturity - Deal ${deal.id}`;
          } else if (deal.deal_type === 'Reverse Repo') {
            const liabilityAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY);
            drAccount = liabilityAccount;
            crAccount = bankAccount;
            description = `Reverse Repo Maturity - Deal ${deal.id}`;
          } else {
            console.warn(`Skipping maturity entry for repo deal ${deal.id}: unsupported deal_type=${deal.deal_type}`);
            continue;
          }

          const lr = await postLedgerEntry({
            date: systemDay,
            dr_account: drAccount,
            cr_account: crAccount,
            amount: maturityAmount,
            deal_id: String(deal.id),
            description
          });
          if (!isLedgerPostOk(lr)) {
            console.error('Repo maturity ledger post failed:', deal.id, lr && lr.error);
            continue;
          }

          await db.query('UPDATE repo_deals SET matured = 1 WHERE id = ?', [deal.id]);
          repoMaturityCount++;
        } catch (err) {
          console.error('Failed to post repo maturity for deal:', deal.id, err);
        }
      }
    } catch (err) {
      console.error('Error in repo maturity block:', err);
    }

    await setSystemDay(tomorrowStr);
    res.json({
      success: true,
      message: `EOD complete. Posted for ${postedCount} money market deals, ${gsecPostedCount} GSec deals, ${fdPostedCount} fixed deposit deals, and ${repoAccrualCount} repo accrual + ${repoMaturityCount} repo maturity + ${repoBackfillCount} repo backfill entries.`,
      next_system_day: tomorrowStr
    });
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