const express = require('express');
const router = express.Router();
const { getAllDeals } = require('../models/moneyMarketDealModel');
const { getSystemDay, setSystemDay } = require('../models/systemDayModel');
const { checkAuth, checkAdmin } = require('../middleware/auth');
const accountMapping = require('../services/accountMappingService');
const {
  computeGsecPerDayAccrual,
  computeGsecDailyAmortization,
  resolveGsecRemainingForDailyPosting
} = require('../services/gsecCouponPeriod');
const { buildSoldByDealMap } = require('../services/gsecSellDeductionService');
const { postFinalApprovedBuyLedger } = require('../services/gsecApprovalLedgerService');
const { postBuySellBuybackLedger } = require('../services/buybackBuySellLedgerService');
const {
  runBuySellDailyAccrualPosting,
  runBuySellDailyAmortizationPosting
} = require('../services/buybackBuySellEodService');
const {
  getBuyRowsForDeal: getGsecBuyRowsForDeal,
  postGsecMaturityLedger
} = require('../services/gsecMaturityLedgerService');
const tbillLedgerService = require('../services/tbillLedgerService');
const { resolveRepoDealNumber } = require('../models/repoDealModel');
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

async function resolveAccountIdByCode(db, accountCode) {
  const [rows] = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [accountCode]
  );
  if (!rows || rows.length === 0) {
    throw new Error(`Account code not found in chart_of_accounts: ${accountCode}`);
  }
  return rows[0].id;
}

async function postLedgerEntryDirect(db, { date, drAccountId, crAccountId, amount, dealId, description }) {
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [date, drAccountId, amount, String(dealId), description, 'LKR']
  );
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
    [date, crAccountId, amount, String(dealId), description, 'LKR']
  );
  return { success: true };
}

async function resolveSettlementAccountCode(db, settlementMode) {
  if (settlementMode) {
    const [settlementRows] = await db.query(
      'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
      [settlementMode]
    );
    if (settlementRows && settlementRows.length > 0 && settlementRows[0].ledger_account_code) {
      return settlementRows[0].ledger_account_code;
    }
  }

  try {
    return await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT);
  } catch (_) {
    return '131-101-410-164-44';
  }
}

function computeGsecCouponSettlementAmount(deal) {
  const remainingFace = Number(deal.remaining_face_value || deal.face_value || 0);
  if (!Number.isFinite(remainingFace) || remainingFace <= 0) {
    return 0;
  }

  const couponPer100 = Number(deal.coupon_amount);
  if (Number.isFinite(couponPer100) && couponPer100 > 0) {
    return Math.floor(((couponPer100 * remainingFace) / 100) * 100000000) / 100000000;
  }

  const couponInterest = Number(deal.coupon_interest);
  const faceValue = Number(deal.face_value || 0);
  if (Number.isFinite(couponInterest) && couponInterest > 0 && Number.isFinite(faceValue) && faceValue > 0) {
    return Math.floor((couponInterest * (remainingFace / faceValue)) * 100000000) / 100000000;
  }

  const couponRate = Number(deal.coupon_rate || 0);
  if (Number.isFinite(couponRate) && couponRate > 0) {
    return Math.floor(((remainingFace * couponRate / 100 / 2) * 100000000)) / 100000000;
  }

  return 0;
}

async function postGsecCouponSettlementDirect(
  db,
  {
    date,
    amount,
    dealId,
    description,
    drAccruedIncomeAccountId,
    crAccruedReceivableAccountId,
    drBankAccountId,
    crCouponIncomeAccountId
  }
) {
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [date, drAccruedIncomeAccountId, amount, String(dealId), description, 'LKR']
  );
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
    [date, crAccruedReceivableAccountId, amount, String(dealId), description, 'LKR']
  );
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [date, drBankAccountId, amount, String(dealId), description, 'LKR']
  );
  await db.query(
    `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
    [date, crCouponIncomeAccountId, amount, String(dealId), description, 'LKR']
  );
  return { success: true };
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
    const db = require('../config/database');
    let mmPostingEnabled = true;
    let mmLendingDrId = null;
    let mmLendingCrId = null;
    let mmBorrowingDrId = null;
    let mmBorrowingCrId = null;
    let mmAlreadyPosted = new Set();
    try {
      const mmLendingDrCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_ASSET);
      const mmLendingCrCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_LENDING_INTEREST_INCOME);
      const mmBorrowingDrCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_EXPENSE);
      const mmBorrowingCrCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.MM_BORROWING_INTEREST_LIABILITY);
      mmLendingDrId = await resolveAccountIdByCode(db, mmLendingDrCode);
      mmLendingCrId = await resolveAccountIdByCode(db, mmLendingCrCode);
      mmBorrowingDrId = await resolveAccountIdByCode(db, mmBorrowingDrCode);
      mmBorrowingCrId = await resolveAccountIdByCode(db, mmBorrowingCrCode);
      const [mmAlreadyPostedRows] = await db.query(
        `SELECT deal_number, description
         FROM ledger_entries
         WHERE DATE(entry_date) = DATE(?)
           AND (description = 'Daily lending interest EOD' OR description = 'Daily borrowing interest EOD')`,
        [systemDay]
      );
      mmAlreadyPosted = new Set(
        (mmAlreadyPostedRows || []).map((r) => {
          const kind = r.description === 'Daily lending interest EOD' ? 'lending' : 'borrowing';
          return `${String(r.deal_number)}:${kind}`;
        })
      );
    } catch (err) {
      mmPostingEnabled = false;
      console.warn('MM mappings are not configured. Skipping MM postings this run:', err.message);
    }
    let postedCount = 0;
    let mmSkippedAlreadyPosted = 0;
    let buybackLeg2BuyPosted = 0;
    let buybackBuySellPosted = 0;
    let buySellAccrualEodResult = {
      posted: 0,
      skipped_already_posted: 0,
      stored_value_corrected: 0,
      deals_loaded: 0
    };
    let buySellAmortEodResult = {
      posted: 0,
      skipped_already_posted: 0,
      enabled: true,
      deals_loaded: 0
    };
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
        if (!mmPostingEnabled) continue;
        const key = `${String(deal.id)}:lending`;
        if (mmAlreadyPosted.has(key)) {
          mmSkippedAlreadyPosted++;
          continue;
        }
        const lr = await postLedgerEntryDirect(db, {
          date: systemDay,
          drAccountId: mmLendingDrId,
          crAccountId: mmLendingCrId,
          amount,
          dealId: deal.id,
          description: 'Daily lending interest EOD'
        });
        if (!isLedgerPostOk(lr)) {
          console.error('MM lending ledger post failed:', deal.id, lr && lr.error);
          continue;
        }
      } else if (dealTypeLower === 'borrowing') {
        if (!mmPostingEnabled) continue;
        const key = `${String(deal.id)}:borrowing`;
        if (mmAlreadyPosted.has(key)) {
          mmSkippedAlreadyPosted++;
          continue;
        }
        const lr = await postLedgerEntryDirect(db, {
          date: systemDay,
          drAccountId: mmBorrowingDrId,
          crAccountId: mmBorrowingCrId,
          amount,
          dealId: deal.id,
          description: 'Daily borrowing interest EOD'
        });
        if (!isLedgerPostOk(lr)) {
          console.error('MM borrowing ledger post failed:', deal.id, lr && lr.error);
          continue;
        }
      }
      
      postedCount++;
    }
    console.log(`MM posting summary: posted=${postedCount}, already_posted_skipped=${mmSkippedAlreadyPosted}`);
    // GSec EOD: parallel DB prefetch, then daily interest accrual + premium/discount amortization in parallel
    console.log('--- GSec EOD posting block reached ---');
    const [
      [gsecDeals],
      [gsecAmortDeals],
      [alreadyPostedRows],
      [alreadyPostedAmortRows],
      [colRows]
    ] = await Promise.all([
      db.query(
        `SELECT g.id, g.deal_number, g.value_date, g.coupon_interest, g.maturity_date, g.face_value, g.remaining_face_value,
                g.isin_number, g.per_day_accrual,
                COALESCE((
                  SELECT SUM(s.face_value)
                  FROM gsec s
                  WHERE s.transaction_type = 'Sell'
                    AND s.buy_deal_number IS NOT NULL
                    AND TRIM(s.buy_deal_number) = TRIM(g.deal_number)
                    AND s.value_date IS NOT NULL
                    AND DATE(s.value_date) <= DATE(?)
                ), 0) AS linked_sold_face_value,
                im.coupon_date_1, im.coupon_date_2, im.coupon_rate
         FROM gsec g
         LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
         WHERE g.transaction_type = 'Buy'
           AND g.status = 'final_approved'
           AND COALESCE(g.matured, 0) = 0
           AND DATE(g.maturity_date) > DATE(?)
           AND g.value_date IS NOT NULL
           AND DATE(g.value_date) <= DATE(?)
           AND (g.coupon_interest IS NOT NULL AND g.coupon_interest > 0
                OR im.coupon_rate IS NOT NULL AND im.coupon_rate > 0)`,
        [systemDay, systemDay, systemDay]
      ),
      db.query(
        `SELECT g.id, g.deal_number, g.value_date, g.maturity_date, g.face_value,
                g.remaining_face_value, g.clean_price,
                COALESCE((
                  SELECT SUM(s.face_value)
                  FROM gsec s
                  WHERE s.transaction_type = 'Sell'
                    AND s.buy_deal_number IS NOT NULL
                    AND TRIM(s.buy_deal_number) = TRIM(g.deal_number)
                    AND s.value_date IS NOT NULL
                    AND DATE(s.value_date) <= DATE(?)
                ), 0) AS linked_sold_face_value
         FROM gsec g
         WHERE g.transaction_type = 'Buy'
           AND g.status = 'final_approved'
           AND COALESCE(g.matured, 0) = 0
           AND DATE(g.maturity_date) > DATE(?)
           AND g.value_date IS NOT NULL
           AND DATE(g.value_date) <= DATE(?)
           AND COALESCE(g.remaining_face_value, g.face_value, 0) > 0`,
        [systemDay, systemDay, systemDay]
      ),
      db.query(
        `SELECT DISTINCT deal_number
         FROM ledger_entries
         WHERE DATE(entry_date) = DATE(?)
           AND description LIKE 'GSec Daily Accrual for Deal %'`,
        [systemDay]
      ),
      db.query(
        `SELECT DISTINCT deal_number
         FROM ledger_entries
         WHERE DATE(entry_date) = DATE(?)
           AND description LIKE 'GSec Daily Amortization for Deal %'`,
        [systemDay]
      ),
      db.query(
        `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'gsec'
           AND COLUMN_NAME = 'per_day_amortization'
         LIMIT 1`
      )
    ]);

    console.log('GSec accrual deals loaded:', gsecDeals.length);
    console.log('GSec amortization deals loaded:', gsecAmortDeals.length);

    const accrualDealNumbers = (gsecDeals || [])
      .map((d) => String(d.deal_number || '').trim())
      .filter(Boolean);
    const soldByDealForAccrual = await buildSoldByDealMap(db, accrualDealNumbers, systemDay);
    for (const deal of gsecDeals || []) {
      const dn = String(deal.deal_number || '').trim();
      deal.linked_sold_face_value = Number(soldByDealForAccrual[dn] || 0);
    }

    const amortDealNumbers = (gsecAmortDeals || [])
      .map((d) => String(d.deal_number || '').trim())
      .filter(Boolean);
    const soldByDealForAmort = await buildSoldByDealMap(db, amortDealNumbers, systemDay);
    for (const deal of gsecAmortDeals || []) {
      const dn = String(deal.deal_number || '').trim();
      deal.linked_sold_face_value = Number(soldByDealForAmort[dn] || 0);
    }

    const hasPerDayAmortizationColumn = Array.isArray(colRows) && colRows.length > 0;

    // ── Aggregate per-Buy-deal buyback deductions so daily accrual is computed on the
    // ── true remaining face. Without this, deals that were partially bought back have
    // ── remaining_face_value < face_value but linked_sold_face_value = 0, which makes
    // ── the safety guard in computeGsecPerDayAccrual reset remaining back to face and
    // ── inflate the accrual.
    //
    // Each buyback deal contributes ONCE, using whichever field actually drove its
    // remaining_face_value deduction at approval time (buybackDealController.js: when
    // sell_deal_allocations is present it is authoritative and source_buy_deal_number
    // is just a legacy mirror of the primary allocation; only fall back to
    // source_buy_deal_number when there are no allocations). Summing both fields
    // independently double-counts every buyback that has both populated (which is
    // every single-allocation buyback), zeroing out the effective remaining face and
    // suppressing that day's accrual for the underlying buy deal.
    const buybackByDealForAccrual = {};
    try {
      const buyDealNumbersForBB = (gsecDeals || [])
        .map((d) => String(d.deal_number || '').trim())
        .filter(Boolean);

      let hasSellDealAllocationsCol = false;
      let hasBBPortfolioCol = false;
      let hasBBTransactionTypeCol = false;
      try {
        const [bbSchemaRows] = await db.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buyback_deals'
             AND COLUMN_NAME IN ('sell_deal_allocations', 'leg1_portfolio', 'leg1_transaction_type')`
        );
        const cols = new Set((bbSchemaRows || []).map((r) => r.COLUMN_NAME));
        hasSellDealAllocationsCol = cols.has('sell_deal_allocations');
        hasBBPortfolioCol = cols.has('leg1_portfolio');
        hasBBTransactionTypeCol = cols.has('leg1_transaction_type');
      } catch (_) { /* leave defaults */ }

      if (buyDealNumbersForBB.length) {
        let bbSql = `
          SELECT deal_number, TRIM(source_buy_deal_number) AS source_buy_deal_number,
                 leg1_face_value${hasSellDealAllocationsCol ? ', sell_deal_allocations' : ''}
          FROM buyback_deals
          WHERE deal_status = 'Approved'
            AND approved_at IS NOT NULL
            AND DATE(approved_at) <= DATE(?)`;
        const bbParams = [systemDay];
        if (hasBBTransactionTypeCol) bbSql += ` AND leg1_transaction_type = 'Sell'`;
        const [bbRows] = await db.query(bbSql, bbParams);

        const buyDealSet = new Set(buyDealNumbersForBB);
        for (const r of bbRows || []) {
          let allocs = hasSellDealAllocationsCol ? r.sell_deal_allocations : null;
          if (typeof allocs === 'string') {
            try { allocs = JSON.parse(allocs); } catch { allocs = null; }
          }

          if (Array.isArray(allocs) && allocs.length > 0) {
            // Authoritative: this is what actually drove the remaining_face_value deduction.
            for (const a of allocs) {
              const dn = String((a && a.deal_number) || '').trim();
              const amt = Number(a && a.amountToSell) || 0;
              if (dn && amt > 0 && buyDealSet.has(dn)) {
                buybackByDealForAccrual[dn] = (buybackByDealForAccrual[dn] || 0) + amt;
              }
            }
          } else if (r.source_buy_deal_number) {
            // Legacy fallback: only used when the buyback has no allocations breakdown.
            const dn = r.source_buy_deal_number;
            const amt = Number(r.leg1_face_value) || 0;
            if (dn && amt > 0 && buyDealSet.has(dn)) {
              buybackByDealForAccrual[dn] = (buybackByDealForAccrual[dn] || 0) + amt;
            }
          }
        }
      }
      // Keep variable to silence lint when portfolio col is unused (kept for future filtering).
      void hasBBPortfolioCol;
    } catch (bbAggErr) {
      console.warn(
        'Failed to aggregate buyback deductions for GSec accrual (continuing with sells only):',
        bbAggErr.message
      );
    }

    const [gsecDrAccountCode, gsecCrAccountCode] = await Promise.all([
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_ASSET),
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_ACCRUAL_INCOME)
    ]);
    const [gsecDrAccountId, gsecCrAccountId] = await Promise.all([
      resolveAccountIdByCode(db, gsecDrAccountCode),
      resolveAccountIdByCode(db, gsecCrAccountCode)
    ]);

    let amortTradingAccountId = null;
    let amortFaAccountId = null;
    let amortPostingEnabled = false;
    try {
      const [amortTradingCode, amortFaCode] = await Promise.all([
        accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_AMORTISATION_TRADING),
        accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_FINANCIAL_ASSETS_AMORTISED_COST)
      ]);
      amortTradingAccountId = await resolveAccountIdByCode(db, amortTradingCode);
      amortFaAccountId = await resolveAccountIdByCode(db, amortFaCode);
      amortPostingEnabled = true;
    } catch (amortMapErr) {
      console.warn(
        'GSec amortization account mappings missing. Skipping amortization this run:',
        amortMapErr.message
      );
    }

    const runGsecDailyAccrualPosting = async () => {
      const alreadyPostedDeals = new Set((alreadyPostedRows || []).map((r) => String(r.deal_number)));
      let posted = 0;
      let skippedAlreadyPosted = 0;
      let storedValueCorrected = 0;
      for (const deal of gsecDeals) {
        try {
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
              storedValueCorrected++;
            }
            continue;
          }
          const dnForBB = String(deal.deal_number || '').trim();
          const linkedBuybackForDeal = Number(buybackByDealForAccrual[dnForBB] || 0);
          const effectiveRemaining = resolveGsecRemainingForDailyPosting(deal, {
            linked_buyback_face_value: linkedBuybackForDeal
          });
          const dealForAccrual = Object.assign({}, deal, {
            remaining_face_value: effectiveRemaining,
            linked_buyback_face_value: linkedBuybackForDeal
          });
          const computed = computeGsecPerDayAccrual(dealForAccrual, systemDay, 2);
          if (!computed.ok) {
            console.warn('Skipping GSec deal:', deal.deal_number, computed.reason);
            if (Number(deal.per_day_accrual) > 0) {
              await db.query('UPDATE gsec SET per_day_accrual = 0 WHERE id = ?', [deal.id]);
              storedValueCorrected++;
            }
            continue;
          }
          const { amount, E } = computed;
          if (alreadyPostedDeals.has(String(deal.deal_number))) {
            skippedAlreadyPosted++;
          } else {
            const lr = await postLedgerEntryDirect(db, {
              date: systemDay,
              drAccountId: gsecDrAccountId,
              crAccountId: gsecCrAccountId,
              amount,
              dealId: deal.deal_number,
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
            alreadyPostedDeals.add(String(deal.deal_number));
            posted++;
          }
          const existingPerDay = Number(deal.per_day_accrual) || 0;
          if (Math.abs(existingPerDay - Number(amount)) > 0.00000001) {
            storedValueCorrected++;
          }
          await db.query(
            `UPDATE gsec SET per_day_accrual = ?, number_of_days_for_coupon_period = ? WHERE id = ?`,
            [amount, E, deal.id]
          );
        } catch (err) {
          console.error('Failed to post GSec ledger for deal:', deal.deal_number, err);
        }
      }
      return {
        posted,
        skipped_already_posted: skippedAlreadyPosted,
        stored_value_corrected: storedValueCorrected,
        deals_loaded: gsecDeals.length
      };
    };

    const runGsecDailyAmortizationPosting = async () => {
      if (!amortPostingEnabled) {
        return {
          posted: 0,
          skipped_already_posted: 0,
          enabled: false,
          deals_loaded: gsecAmortDeals.length
        };
      }
      const alreadyPostedAmortDeals = new Set(
        (alreadyPostedAmortRows || []).map((r) => String(r.deal_number))
      );
      let posted = 0;
      let skippedAlreadyPosted = 0;
      for (const deal of gsecAmortDeals) {
        try {
          if (!valueDateOnOrBeforeSystemDay(deal.value_date, systemDay)) {
            continue;
          }
          const dnForAmort = String(deal.deal_number || '').trim();
          const linkedBuybackForAmort = Number(buybackByDealForAccrual[dnForAmort] || 0);
          const effectiveRemainingAmort = resolveGsecRemainingForDailyPosting(deal, {
            linked_buyback_face_value: linkedBuybackForAmort
          });
          if (effectiveRemainingAmort <= 0) {
            if (hasPerDayAmortizationColumn) {
              await db.query('UPDATE gsec SET per_day_amortization = 0 WHERE id = ?', [deal.id]);
            }
            continue;
          }
          const dealForAmort = Object.assign({}, deal, {
            remaining_face_value: effectiveRemainingAmort
          });
          const computed = computeGsecDailyAmortization(dealForAmort, systemDay);
          if (!computed.ok) {
            if (hasPerDayAmortizationColumn) {
              await db.query('UPDATE gsec SET per_day_amortization = 0 WHERE id = ?', [deal.id]);
            }
            continue;
          }
          const { dailyAmount, scenario } = computed;

          if (hasPerDayAmortizationColumn) {
            await db.query('UPDATE gsec SET per_day_amortization = ? WHERE id = ?', [
              dailyAmount,
              deal.id
            ]);
          }

          if (alreadyPostedAmortDeals.has(String(deal.deal_number))) {
            skippedAlreadyPosted++;
            continue;
          }

          let drId;
          let crId;
          if (scenario === 'premium') {
            drId = amortTradingAccountId;
            crId = amortFaAccountId;
          } else {
            drId = amortFaAccountId;
            crId = amortTradingAccountId;
          }

          const lr = await postLedgerEntryDirect(db, {
            date: systemDay,
            drAccountId: drId,
            crAccountId: crId,
            amount: dailyAmount,
            dealId: deal.deal_number,
            description: `GSec Daily Amortization for Deal ${deal.deal_number}`
          });
          if (!isLedgerPostOk(lr)) {
            console.error(
              'GSec amortization ledger post failed:',
              deal.deal_number,
              lr && lr.error
            );
            continue;
          }
          alreadyPostedAmortDeals.add(String(deal.deal_number));
          posted++;
        } catch (err) {
          console.error('Failed GSec amortization for deal:', deal.deal_number, err);
        }
      }
      return {
        posted,
        skipped_already_posted: skippedAlreadyPosted,
        enabled: true,
        deals_loaded: gsecAmortDeals.length
      };
    };

    const [gsecAccrualEodResult, gsecAmortEodResult] = await Promise.all([
      runGsecDailyAccrualPosting(),
      runGsecDailyAmortizationPosting()
    ]);

    const gsecPostedCount = gsecAccrualEodResult.posted;
    const gsecSkippedAlreadyPosted = gsecAccrualEodResult.skipped_already_posted;
    const gsecAmortPostedCount = gsecAmortEodResult.posted;
    const gsecAmortSkippedAlreadyPosted = gsecAmortEodResult.skipped_already_posted;

    console.log(
      `GSec accrual summary: posted=${gsecPostedCount}, already_posted_skipped=${gsecSkippedAlreadyPosted}, stored_value_corrected=${gsecAccrualEodResult.stored_value_corrected}`
    );
    console.log(
      `GSec amortization summary: posted=${gsecAmortPostedCount}, already_posted_skipped=${gsecAmortSkippedAlreadyPosted}`
    );

    // GSec coupon settlement posting on coupon date (semi-annual schedule)
    let gsecCouponPostedCount = 0;
    let gsecCouponSkippedAlreadyPosted = 0;
    const gsecCouponIncomeCode = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.GSEC_COUPON_INCOME);
    const gsecCouponIncomeId = await resolveAccountIdByCode(db, gsecCouponIncomeCode);
    const [dueCouponDeals] = await db.query(
      `SELECT g.id, g.deal_number, g.isin_number, g.value_date, g.maturity_date, g.face_value,
              g.remaining_face_value, g.coupon_interest, g.settlement_mode,
              im.coupon_rate, ics.coupon_date, ics.coupon_amount
       FROM gsec g
       JOIN isin_coupon_schedule ics
         ON ics.isin COLLATE utf8mb4_unicode_ci = g.isin_number COLLATE utf8mb4_unicode_ci
        AND DATE(ics.coupon_date) = DATE(?)
       LEFT JOIN isin_master im
         ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
       WHERE g.transaction_type = 'Buy'
         AND g.status = 'final_approved'
         AND COALESCE(g.matured, 0) = 0
         AND DATE(g.value_date) <= DATE(?)
         AND DATE(g.maturity_date) >= DATE(?)
         AND COALESCE(g.remaining_face_value, g.face_value, 0) > 0`,
      [systemDay, systemDay, systemDay]
    );
    const [alreadyPostedCouponRows] = await db.query(
      `SELECT deal_number, description
       FROM ledger_entries
       WHERE DATE(entry_date) = DATE(?)
         AND description LIKE 'GSec Coupon Settlement %'`,
      [systemDay]
    );
    const alreadyPostedCoupons = new Set(
      (alreadyPostedCouponRows || []).map((r) => `${String(r.deal_number)}|${String(r.description)}`)
    );
    const settlementAccountCache = new Map();

    for (const deal of dueCouponDeals) {
      try {
        const couponDateStr = new Date(deal.coupon_date).toISOString().slice(0, 10);
        const description = `GSec Coupon Settlement ${deal.deal_number} ${couponDateStr}`;
        const postingKey = `${String(deal.deal_number)}|${description}`;
        if (alreadyPostedCoupons.has(postingKey)) {
          gsecCouponSkippedAlreadyPosted++;
          continue;
        }

        const amount = computeGsecCouponSettlementAmount(deal);
        if (!Number.isFinite(amount) || amount <= 0) {
          continue;
        }

        let bankAccountCode = settlementAccountCache.get(String(deal.settlement_mode || ''));
        if (!bankAccountCode) {
          bankAccountCode = await resolveSettlementAccountCode(db, deal.settlement_mode);
          settlementAccountCache.set(String(deal.settlement_mode || ''), bankAccountCode);
        }
        const bankAccountId = await resolveAccountIdByCode(db, bankAccountCode);

        const lr = await postGsecCouponSettlementDirect(db, {
          date: systemDay,
          amount,
          dealId: deal.deal_number,
          description,
          drAccruedIncomeAccountId: gsecCrAccountId,
          crAccruedReceivableAccountId: gsecDrAccountId,
          drBankAccountId: bankAccountId,
          crCouponIncomeAccountId: gsecCouponIncomeId
        });
        if (!isLedgerPostOk(lr)) {
          console.error('GSec coupon settlement post failed:', deal.deal_number, lr && lr.error);
          continue;
        }

        alreadyPostedCoupons.add(postingKey);
        gsecCouponPostedCount++;
      } catch (err) {
        console.error('Failed to post GSec coupon settlement for deal:', deal.deal_number, err);
      }
    }
    console.log(
      `GSec coupon settlement summary: posted=${gsecCouponPostedCount}, already_posted_skipped=${gsecCouponSkippedAlreadyPosted}`
    );

    // Buyback leg2 (Buy) compound purchase: post only when system day >= value date (not on early approval); skip if ledger already exists (e.g. pre-maturity / prior run).
    try {
      const [leg2BuyDeals] = await db.query(
        `SELECT g.*, bd.deal_number AS buyback_deal_number
         FROM gsec g
         INNER JOIN buyback_deals bd ON bd.id = g.buyback_deal_id
         WHERE g.transaction_type = 'Buy'
           AND g.status = 'final_approved'
           AND g.buyback_deal_id IS NOT NULL
           AND g.value_date IS NOT NULL
           AND DATE(g.value_date) <= DATE(?)
           AND NOT EXISTS (
             SELECT 1 FROM ledger_entries le
             WHERE le.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci
               AND le.description LIKE '%GSec Purchase%'
           )`,
        [systemDay]
      );
      for (const gsecRow of leg2BuyDeals || []) {
        try {
          const bbNum = gsecRow.buyback_deal_number != null ? String(gsecRow.buyback_deal_number) : '';
          const bbPrefix = bbNum ? `Buyback ${bbNum} - ` : 'Buyback - ';
          const buyLedgerRes = await postFinalApprovedBuyLedger(gsecRow, {
            descriptionPrefix: bbPrefix,
            bankAmountFromSettlement: true
          });
          if (!isLedgerPostOk(buyLedgerRes)) {
            console.error(
              'Buyback leg2 buy ledger (EOD) failed:',
              gsecRow.deal_number,
              buyLedgerRes && buyLedgerRes.error
            );
            continue;
          }
          buybackLeg2BuyPosted++;
        } catch (leg2EodErr) {
          console.error('Buyback leg2 buy ledger (EOD) error:', gsecRow.deal_number, leg2EodErr);
        }
      }
      if ((leg2BuyDeals || []).length > 0) {
        console.log(
          `Buyback leg2 buy compound ledger (EOD): candidates=${leg2BuyDeals.length}, posted=${buybackLeg2BuyPosted}`
        );
      }
    } catch (buybackLeg2EodErr) {
      console.error('Buyback leg2 buy ledger (EOD) block failed:', buybackLeg2EodErr);
    }

    // Buy/Sell buyback (leg1 Buy + leg2 Sell): ledger-only legs that were deferred
    // at approval because their value date was in the future now post once the
    // system day reaches each leg's value date. The service is idempotent (skips
    // already-posted legs) and re-applies the same value-date deferral rule.
    try {
      const [buySellBuybacks] = await db.query(
        `SELECT * FROM buyback_deals
         WHERE deal_status = 'Approved'
           AND (leg1_transaction_type = 'Buy' OR leg2_transaction_type = 'Sell')
           AND (
             DATE(leg1_value_date) <= DATE(?)
             OR DATE(leg2_value_date) <= DATE(?)
           )`,
        [systemDay, systemDay]
      );
      for (const bb of buySellBuybacks || []) {
        try {
          const result = await postBuySellBuybackLedger(bb, { systemDate: systemDay });
          result.actions.forEach((a) => {
            if (a.status === 'posted' || a.status === 'posted_legacy') {
              buybackBuySellPosted++;
              console.log(`Buyback buy/sell ledger (EOD): ${bb.deal_number} ${a.leg}/${a.type} posted`);
            } else if (a.status === 'failed') {
              console.error(
                `Buyback buy/sell ledger (EOD) failed: ${bb.deal_number} ${a.leg}/${a.type}`,
                a.error
              );
            }
          });
        } catch (bbErr) {
          console.error('Buyback buy/sell ledger (EOD) error:', bb.deal_number, bbErr);
        }
      }
      if ((buySellBuybacks || []).length > 0) {
        console.log(
          `Buyback buy/sell ledger (EOD): candidates=${buySellBuybacks.length}, posted=${buybackBuySellPosted}`
        );
      }
    } catch (buySellEodErr) {
      console.error('Buyback buy/sell ledger (EOD) block failed:', buySellEodErr);
    }

    // Buy/Sell buyback leg1 daily accrual + amortization (fixed face; stops on leg2 value date)
    try {
      [buySellAccrualEodResult, buySellAmortEodResult] = await Promise.all([
        runBuySellDailyAccrualPosting(systemDay),
        runBuySellDailyAmortizationPosting(systemDay)
      ]);
      console.log(
        `Buy/Sell buyback EOD accrual: posted=${buySellAccrualEodResult.posted}, skipped=${buySellAccrualEodResult.skipped_already_posted}, deals=${buySellAccrualEodResult.deals_loaded}`
      );
      console.log(
        `Buy/Sell buyback EOD amort: posted=${buySellAmortEodResult.posted}, skipped=${buySellAmortEodResult.skipped_already_posted}, deals=${buySellAmortEodResult.deals_loaded}`
      );
    } catch (buySellDailyEodErr) {
      console.error('Buy/Sell buyback daily accrual/amort (EOD) block failed:', buySellDailyEodErr);
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
        `SELECT rd.id, rd.deal_number, rd.deal_type, rd.principal_amount, rd.settlement_mode, rd.value_date
         FROM repo_deals rd
         WHERE rd.approval_status = 'final_approved'
           AND NOT EXISTS (
             SELECT 1 FROM ledger_entries le
             WHERE le.deal_number COLLATE utf8mb4_unicode_ci = rd.deal_number COLLATE utf8mb4_unicode_ci
           )`
      );
      console.log('Repo deals to backfill:', repoBackfillDeals.length);

      for (const deal of repoBackfillDeals) {
        const dealNumber = resolveRepoDealNumber(deal);
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

          if (deal.deal_type === 'Reverse Repo') {
            // Reverse Repo (Sherwood lends, asset side): DR Reverse Repo asset, CR Bank
            drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET);
            crAccount = bankAccount;
            description = `Reverse Repo Purchase (Backfill) - Deal ${dealNumber}`;
          } else if (deal.deal_type === 'Repo') {
            // Repo (Sherwood borrows): DR Bank, CR Repo liability
            drAccount = bankAccount;
            crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY);
            description = `Repo Borrowing (Backfill) - Deal ${dealNumber}`;
          } else {
            console.warn(`Skipping backfill for repo deal ${deal.id}: unsupported deal_type=${deal.deal_type}`);
            continue;
          }

          const lr = await postLedgerEntry({
            date: valueDate,
            dr_account: drAccount,
            cr_account: crAccount,
            amount: Number(deal.principal_amount),
            deal_id: dealNumber,
            description
          });
          if (!isLedgerPostOk(lr)) {
            console.error('Repo backfill ledger post failed:', dealNumber, lr && lr.error);
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
        `SELECT id, deal_number, deal_type, daily_accrual, value_date, maturity_date
         FROM repo_deals
         WHERE approval_status = 'final_approved'
           AND daily_accrual IS NOT NULL AND daily_accrual > 0
           AND value_date <= ? AND maturity_date > ?`,
        [systemDay, systemDay]
      );
      console.log('Repo deals for daily accrual:', repoAccrualDeals.length);
      const [repoAccrualAlreadyRows] = await db.query(
        `SELECT deal_number, description
         FROM ledger_entries
         WHERE DATE(entry_date) = DATE(?)
           AND (description LIKE 'Repo Daily Interest Accrual - Deal %'
                OR description LIKE 'Reverse Repo Daily Interest Accrual - Deal %')`,
        [systemDay]
      );
      const repoAccrualAlready = new Set(
        (repoAccrualAlreadyRows || []).map((r) => `${String(r.deal_number)}|${String(r.description)}`)
      );

      for (const deal of repoAccrualDeals) {
        const dealNumber = resolveRepoDealNumber(deal);
        try {
          const amount = Number(deal.daily_accrual);
          if (isNaN(amount) || amount === 0) continue;

          if (deal.deal_type === 'Reverse Repo') {
            // Reverse Repo (asset side): accrue interest income on the asset.
            const description = `Reverse Repo Daily Interest Accrual - Deal ${dealNumber}`;
            const key = `${dealNumber}|${description}`;
            if (repoAccrualAlready.has(key)) {
              continue;
            }
            const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET);
            const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_INTEREST_INCOME);
            const lr = await postLedgerEntry({
              date: systemDay,
              dr_account: drAccount,
              cr_account: crAccount,
              amount,
              deal_id: dealNumber,
              description
            });
            if (!isLedgerPostOk(lr)) {
              console.error('Reverse repo accrual ledger post failed:', dealNumber, lr && lr.error);
              continue;
            }
            repoAccrualAlready.add(key);
            repoAccrualCount++;
          } else if (deal.deal_type === 'Repo') {
            // Repo (borrowing): accrue interest expense / payable.
            const description = `Repo Daily Interest Accrual - Deal ${dealNumber}`;
            const key = `${dealNumber}|${description}`;
            if (repoAccrualAlready.has(key)) {
              continue;
            }
            const drAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_EXPENSE);
            const crAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_PAYABLE);
            const lr = await postLedgerEntry({
              date: systemDay,
              dr_account: drAccount,
              cr_account: crAccount,
              amount,
              deal_id: dealNumber,
              description
            });
            if (!isLedgerPostOk(lr)) {
              console.error('Repo accrual ledger post failed:', dealNumber, lr && lr.error);
              continue;
            }
            repoAccrualAlready.add(key);
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
        `SELECT id, deal_number, deal_type, principal_amount, interest_amount, settlement_mode, maturity_date
         FROM repo_deals
         WHERE approval_status = 'final_approved'
           AND maturity_date = ? AND matured = 0`,
        [tomorrowStr]
      );
      console.log('Repo deals maturing tomorrow:', maturingRepoDeals.length);
      const [repoMaturityAlreadyRows] = await db.query(
        `SELECT deal_number, description
         FROM ledger_entries
         WHERE DATE(entry_date) = DATE(?)
           AND (description LIKE 'Repo Maturity - Deal %'
                OR description LIKE 'Reverse Repo Maturity - Deal %'
                OR description LIKE 'Repo Interest Accrual Reversal - Deal %'
                OR description LIKE 'Reverse Repo Interest Accrual Reversal - Deal %')`,
        [tomorrowStr]
      );
      const repoMaturityAlready = new Set(
        (repoMaturityAlreadyRows || []).map((r) => `${String(r.deal_number)}|${String(r.description)}`)
      );

      for (const deal of maturingRepoDeals) {
        const dealNumber = resolveRepoDealNumber(deal);
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
          const principalAmount = Number(deal.principal_amount) || 0;
          const interestAmount = Number(deal.interest_amount) || 0;
          const maturityAmount = principalAmount + interestAmount;

          // Maturity ledger entry must be dated on the MATURITY date (tomorrow),
          // not the system day this EOD runs on. The deal is selected because it
          // matures tomorrow (maturity_date = tomorrowStr), so the principal/
          // interest repayment booking belongs to that date. (Daily accruals
          // above are correctly dated systemDay.)
          const maturityEntryDate = deal.maturity_date
            ? new Date(deal.maturity_date).toISOString().slice(0, 10)
            : tomorrowStr;

          if (deal.deal_type === 'Reverse Repo') {
            // Reverse Repo (asset side): proceeds come back → DR Bank, CR asset.
            const repoAsset = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET);
            const description = `Reverse Repo Maturity - Deal ${dealNumber}`;
            const maturityKey = `${dealNumber}|${description}`;
            if (repoMaturityAlready.has(maturityKey)) {
              await db.query("UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?", [deal.id]);
              continue;
            }
            const lr = await postLedgerEntry({
              date: maturityEntryDate,
              dr_account: bankAccount,
              cr_account: repoAsset,
              amount: maturityAmount,
              deal_id: dealNumber,
              description
            });
            if (!isLedgerPostOk(lr)) {
              console.error('Reverse repo maturity ledger post failed:', dealNumber, lr && lr.error);
              continue;
            }
            await db.query("UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?", [deal.id]);
            repoMaturityAlready.add(maturityKey);
            repoMaturityCount++;
          } else if (deal.deal_type === 'Repo') {
            // Repo (borrowing): unwind accrual, repay principal + interest.
            const description = `Repo Maturity - Deal ${dealNumber}`;
            const reversalDescription = `Repo Interest Accrual Reversal - Deal ${dealNumber}`;
            const maturityKey = `${dealNumber}|${description}`;
            if (repoMaturityAlready.has(maturityKey)) {
              // If already posted previously (e.g., prior timed-out attempt), only mark matured.
              // Also flip status so collateral / availability queries that filter by
              // status (rather than matured) stop counting this deal.
              await db.query("UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?", [deal.id]);
              continue;
            }

            // Repo (borrowing) maturity is booked as three balanced pairs so the interest
            // is recognised in its own expense account and the daily accrual is unwound:
            //   1. Reverse accrued interest: DR Interest Payable (780) / CR daily-accrual Interest Expense (752)
            //   2. Settle principal:         DR Repo Liability (308)    / CR Bank
            //   3. Recognise interest:       DR Interest Expense Repo Borrowing (768) / CR Bank
            const liabilityAccount = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY);
            const interestPayable = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_PAYABLE);
            const accrualInterestExpense = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_EXPENSE);
            const maturityInterestExpense = await accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_MATURITY_INTEREST_EXPENSE);

            let postOk = true;

            const reversalKey = `${dealNumber}|${reversalDescription}`;
            if (interestAmount > 0 && !repoMaturityAlready.has(reversalKey)) {
              const reversal = await postLedgerEntry({
                date: maturityEntryDate,
                dr_account: interestPayable,
                cr_account: accrualInterestExpense,
                amount: interestAmount,
                deal_id: dealNumber,
                description: reversalDescription
              });
              if (!isLedgerPostOk(reversal)) {
                console.error('Repo interest accrual reversal post failed:', dealNumber, reversal && reversal.error);
                postOk = false;
              } else {
                repoMaturityAlready.add(reversalKey);
              }
            }

            if (postOk && principalAmount > 0) {
              const principalLeg = await postLedgerEntry({
                date: maturityEntryDate,
                dr_account: liabilityAccount,
                cr_account: bankAccount,
                amount: principalAmount,
                deal_id: dealNumber,
                description
              });
              if (!isLedgerPostOk(principalLeg)) {
                console.error('Repo principal maturity post failed:', dealNumber, principalLeg && principalLeg.error);
                postOk = false;
              }
            }

            if (postOk && interestAmount > 0) {
              const interestLeg = await postLedgerEntry({
                date: maturityEntryDate,
                dr_account: maturityInterestExpense,
                cr_account: bankAccount,
                amount: interestAmount,
                deal_id: dealNumber,
                description
              });
              if (!isLedgerPostOk(interestLeg)) {
                console.error('Repo interest maturity post failed:', dealNumber, interestLeg && interestLeg.error);
                postOk = false;
              }
            }

            if (!postOk) {
              continue;
            }

            await db.query("UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?", [deal.id]);
            repoMaturityAlready.add(maturityKey);
            repoMaturityCount++;
          } else {
            console.warn(`Skipping maturity entry for repo deal ${deal.id}: unsupported deal_type=${deal.deal_type}`);
            continue;
          }
        } catch (err) {
          console.error('Failed to post repo maturity for deal:', deal.id, err);
        }
      }
    } catch (err) {
      console.error('Error in repo maturity block:', err);
    }

    // --- GSec outright-purchase maturity (redemption) posting ---
    // Mirrors the repo maturity block: book the par redemption journal for Buy
    // holdings maturing on (or overdue up to) the maturity date, dated on each
    // deal's own maturity_date. The shared service is idempotent (skips deals that
    // already have a redemption entry) and flags gsec.matured = 1 after posting.
    //   DR Bank (par) / CR Treasury Bonds - Trading (clean cost)
    //   / CR Amortised Discount Received (discount)   [premium flips the discount line to DR]
    console.log('--- GSec maturity (redemption) posting block reached ---');
    let gsecMaturityPostedCount = 0;
    let gsecMaturitySkippedCount = 0;
    try {
      const [maturingGsecDeals] = await db.query(
        `SELECT DISTINCT TRIM(deal_number) AS deal_number
         FROM gsec
         WHERE transaction_type = 'Buy'
           AND status = 'final_approved'
           AND COALESCE(matured, 0) = 0
           AND maturity_date IS NOT NULL
           AND DATE(maturity_date) <= DATE(?)
           AND COALESCE(remaining_face_value, face_value, 0) > 0`,
        [tomorrowStr]
      );
      console.log('GSec deals due for maturity redemption:', maturingGsecDeals.length);

      for (const row of maturingGsecDeals) {
        const dealNumber = row.deal_number;
        try {
          const buyRows = await getGsecBuyRowsForDeal(dealNumber);
          if (!buyRows.length) continue;
          const result = await postGsecMaturityLedger(buyRows);
          if (result.posted) {
            gsecMaturityPostedCount++;
            console.log(`GSec maturity redemption posted: ${dealNumber}`);
          } else if (result.skipped) {
            gsecMaturitySkippedCount++;
          } else if (!result.success) {
            console.error('GSec maturity redemption post failed:', dealNumber, result.error);
          }
        } catch (gsecMatErr) {
          console.error('Failed to post GSec maturity for deal:', dealNumber, gsecMatErr);
        }
      }
      console.log(
        `GSec maturity summary: posted=${gsecMaturityPostedCount}, already_posted_skipped=${gsecMaturitySkippedCount}`
      );
    } catch (err) {
      console.error('Error in GSec maturity block:', err);
    }

    // --- T-Bill daily discount accrual + maturity (redemption) posting ---
    console.log('--- T-Bill EOD posting block reached ---');
    let tbillAccrualPostedCount = 0;
    let tbillAccrualSkippedCount = 0;
    let tbillMaturityPostedCount = 0;
    let tbillMaturitySkippedCount = 0;
    try {
      const [tbillAccrualDeals] = await db.query(
        `SELECT * FROM tbill
         WHERE transaction_type = 'Buy'
           AND status = 'final_approved'
           AND COALESCE(matured, 0) = 0
           AND maturity_date IS NOT NULL
           AND DATE(maturity_date) > DATE(?)
           AND value_date IS NOT NULL
           AND DATE(value_date) <= DATE(?)
           AND COALESCE(remaining_face_value, face_value, 0) > 0`,
        [systemDay, systemDay]
      );
      console.log('T-Bill accrual deals loaded:', tbillAccrualDeals.length);

      for (const deal of tbillAccrualDeals) {
        try {
          const r = await tbillLedgerService.postTbillDailyAccrual(deal, systemDay);
          if (!r.success) {
            console.error('T-Bill accrual ledger post failed:', deal.deal_number, r.error);
          } else if (r.posted) {
            tbillAccrualPostedCount++;
          } else if (r.skipped === 'already_posted') {
            tbillAccrualSkippedCount++;
          }
        } catch (err) {
          console.error('Failed T-Bill accrual for deal:', deal.deal_number, err);
        }
      }

      const [maturingTbillDeals] = await db.query(
        `SELECT * FROM tbill
         WHERE transaction_type = 'Buy'
           AND status = 'final_approved'
           AND COALESCE(matured, 0) = 0
           AND maturity_date IS NOT NULL
           AND DATE(maturity_date) <= DATE(?)
           AND COALESCE(remaining_face_value, face_value, 0) > 0`,
        [tomorrowStr]
      );
      console.log('T-Bill deals due for maturity redemption:', maturingTbillDeals.length);

      for (const buyRow of maturingTbillDeals) {
        try {
          const r = await tbillLedgerService.postTbillMaturityLedger(buyRow);
          if (!r.success) {
            console.error('T-Bill maturity redemption post failed:', buyRow.deal_number, r.error);
          } else if (r.posted) {
            tbillMaturityPostedCount++;
            console.log(`T-Bill maturity redemption posted: ${buyRow.deal_number}`);
          } else if (r.skipped === 'already_posted') {
            tbillMaturitySkippedCount++;
          }
        } catch (err) {
          console.error('Failed to post T-Bill maturity for deal:', buyRow.deal_number, err);
        }
      }
      console.log(
        `T-Bill EOD summary: accrual posted=${tbillAccrualPostedCount}, accrual already_posted_skipped=${tbillAccrualSkippedCount}, maturity posted=${tbillMaturityPostedCount}, maturity already_posted_skipped=${tbillMaturitySkippedCount}`
      );
    } catch (err) {
      console.error('Error in T-Bill EOD block:', err);
    }

    await setSystemDay(tomorrowStr);

    // Force every other logged-in user to log in again once EOD completes; the
    // triggering admin's own session is exempted so they aren't logged out too.
    try {
      const { forceLogoutAllExcept } = require('../models/authSettingsModel');
      await forceLogoutAllExcept(req.user?.id);
    } catch (logoutErr) {
      console.error('Failed to set force-logout state after EOD:', logoutErr);
    }

    res.json({
      success: true,
      message: `EOD complete. Posted for ${postedCount} money market deals, ${gsecPostedCount} GSec accrual deals, ${gsecAmortPostedCount} GSec amortization, ${gsecCouponPostedCount} GSec coupon settlements, ${gsecMaturityPostedCount} GSec maturity redemptions, ${fdPostedCount} fixed deposit deals, ${repoAccrualCount} repo accrual + ${repoMaturityCount} repo maturity + ${repoBackfillCount} repo backfill entries, and ${tbillAccrualPostedCount} T-Bill accrual + ${tbillMaturityPostedCount} T-Bill maturity entries.`,
      next_system_day: tomorrowStr,
      gsec_eod: {
        daily_accrual: {
          posted: gsecAccrualEodResult.posted,
          skipped_already_posted: gsecAccrualEodResult.skipped_already_posted,
          stored_value_corrected: gsecAccrualEodResult.stored_value_corrected,
          deals_loaded: gsecAccrualEodResult.deals_loaded
        },
        daily_amortization: {
          posted: gsecAmortEodResult.posted,
          skipped_already_posted: gsecAmortEodResult.skipped_already_posted,
          enabled: gsecAmortEodResult.enabled,
          deals_loaded: gsecAmortEodResult.deals_loaded
        },
        maturity_redemption: {
          posted: gsecMaturityPostedCount,
          skipped_already_posted: gsecMaturitySkippedCount
        },
        buyback_leg2_buy_posted: buybackLeg2BuyPosted,
        buyback_buy_sell_posted: buybackBuySellPosted,
        buyback_buy_sell_daily_accrual: buySellAccrualEodResult,
        buyback_buy_sell_daily_amortization: buySellAmortEodResult
      },
      tbill_eod: {
        daily_accrual: {
          posted: tbillAccrualPostedCount,
          skipped_already_posted: tbillAccrualSkippedCount
        },
        maturity_redemption: {
          posted: tbillMaturityPostedCount,
          skipped_already_posted: tbillMaturitySkippedCount
        }
      }
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