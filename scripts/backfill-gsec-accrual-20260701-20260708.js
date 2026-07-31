/**
 * Backfill missing GSec daily accrual for 2026-07-01 through 2026-07-08, caused by
 * the buybackByDealForAccrual double-counting bug in moneyMarketEodRoutes.js
 * (now fixed). For each eligible Buy deal and each day in range, reconstructs the
 * TRUE historical remaining_face_value (face minus single-counted, correctly-dated
 * Sell/buyback reductions), computes what accrual SHOULD have posted via the same
 * computeGsecPerDayAccrual formula the real EOD job uses, compares against what
 * actually exists in ledger_entries for that exact day, and posts a backfill entry
 * for any shortfall.
 *
 * Usage:
 *   node scripts/backfill-gsec-accrual-20260701-20260708.js [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]           (dry run, no writes)
 *   node scripts/backfill-gsec-accrual-20260701-20260708.js [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] --commit  (posts backfill entries)
 * Defaults to 2026-07-01..2026-07-08 when --start/--end are omitted.
 */
const db = require('../config/database');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

const COMMIT = process.argv.includes('--commit');
const argDate = (flag, fallback) => {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.split('=')[1] : fallback;
};
const START_DATE = argDate('start', '2026-07-01');
const END_DATE = argDate('end', '2026-07-08');
const DR_ACCOUNT_CODE = '131-101-290-218-44'; // GSec Accrued Interest Receivable
const CR_ACCOUNT_CODE = '467-101-190-470-44'; // GSec Accrued Coupon Interest Income

function ymdRange(startYmd, endYmd) {
  const out = [];
  const d = new Date(`${startYmd}T00:00:00.000Z`);
  const end = new Date(`${endYmd}T00:00:00.000Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

async function resolveAccountId(code) {
  const [rows] = await db.query('SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1', [code]);
  if (!rows.length) throw new Error(`Account code not found: ${code}`);
  return rows[0].id;
}

async function main() {
  const dates = ymdRange(START_DATE, END_DATE);
  console.log(`Backfill window: ${dates.join(', ')}`);
  console.log(COMMIT ? 'MODE: COMMIT (will write to ledger_entries)' : 'MODE: DRY RUN (no writes)');

  // 1. All eligible Buy deals (mirrors the real EOD job's eligibility filter, minus the
  //    single-day date bound - we evaluate eligibility per day below).
  const [gsecDeals] = await db.query(
    `SELECT g.id, g.deal_number, g.value_date, g.maturity_date, g.face_value, g.remaining_face_value,
            g.coupon_interest, g.isin_number, g.status, g.matured,
            im.coupon_rate, im.coupon_date_1, im.coupon_date_2
     FROM gsec g
     LEFT JOIN isin_master im ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.transaction_type = 'Buy'
       AND g.status = 'final_approved'
       AND COALESCE(g.matured, 0) = 0
       AND (g.coupon_interest IS NOT NULL AND g.coupon_interest > 0
            OR im.coupon_rate IS NOT NULL AND im.coupon_rate > 0)`
  );
  console.log(`Eligible Buy deals: ${gsecDeals.length}`);

  // 2. Correct (deduped) buyback deduction events per buy deal, with approval dates.
  const [bbRows] = await db.query(
    `SELECT deal_number, TRIM(source_buy_deal_number) AS source_buy_deal_number, leg1_face_value,
            sell_deal_allocations, approved_at
     FROM buyback_deals
     WHERE deal_status = 'Approved' AND approved_at IS NOT NULL AND leg1_transaction_type = 'Sell'`
  );
  const bbEventsByDeal = {};
  // Deals confirmed to have actually triggered the double-counting bug: a buyback
  // whose source_buy_deal_number AND a sell_deal_allocations entry both point at
  // the SAME buy deal (the exact overlap that summed the same amount twice in the
  // old code). Backfill is scoped to ONLY these deals - not any mismatch this
  // script's reconstruction can detect, which can also flag unrelated data issues
  // (e.g. imprecise Sell value_date tracking) that are out of scope here.
  const confirmedBugDeals = new Set();
  for (const r of bbRows) {
    let allocs = r.sell_deal_allocations;
    if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch { allocs = null; } }
    if (Array.isArray(allocs) && allocs.length > 0) {
      for (const a of allocs) {
        const dn = String((a && a.deal_number) || '').trim();
        const amt = Number(a && a.amountToSell) || 0;
        if (dn && amt > 0) {
          (bbEventsByDeal[dn] = bbEventsByDeal[dn] || []).push({ date: r.approved_at, amt });
        }
      }
      if (r.source_buy_deal_number && allocs.some((a) => String(a.deal_number || '').trim() === r.source_buy_deal_number)) {
        confirmedBugDeals.add(r.source_buy_deal_number);
      }
    } else if (r.source_buy_deal_number) {
      const dn = r.source_buy_deal_number;
      const amt = Number(r.leg1_face_value) || 0;
      if (dn && amt > 0) {
        (bbEventsByDeal[dn] = bbEventsByDeal[dn] || []).push({ date: r.approved_at, amt });
      }
    }
  }
  console.log(`Deals confirmed to have triggered the double-counting bug: ${confirmedBugDeals.size}`);

  // 3. Regular Sell deduction events per buy deal (linked_sold_face_value equivalent), by value_date.
  const [sellRows] = await db.query(
    `SELECT TRIM(buy_deal_number) AS buy_deal_number, face_value, value_date, deal_number, sell_deal_allocations
     FROM gsec
     WHERE transaction_type = 'Sell' AND value_date IS NOT NULL`
  );
  const sellEventsByDeal = {};
  for (const r of sellRows) {
    let allocs = r.sell_deal_allocations;
    if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch { allocs = null; } }
    if (Array.isArray(allocs) && allocs.length > 0) {
      for (const a of allocs) {
        const dn = String((a && a.deal_number) || '').trim();
        const amt = Number(a && a.amountToSell) || 0;
        if (dn && amt > 0) {
          (sellEventsByDeal[dn] = sellEventsByDeal[dn] || []).push({ date: r.value_date, amt });
        }
      }
    } else if (r.buy_deal_number) {
      const dn = r.buy_deal_number;
      const amt = Number(r.face_value) || 0;
      if (dn && amt > 0) {
        (sellEventsByDeal[dn] = sellEventsByDeal[dn] || []).push({ date: r.value_date, amt });
      }
    }
  }

  // 4. Existing accrual ledger postings by (deal_number, entry_date).
  const [existingLedger] = await db.query(
    `SELECT deal_number, entry_date, debit_amount
     FROM ledger_entries
     WHERE description LIKE 'GSec Daily Accrual for Deal %'
       AND entry_date BETWEEN ? AND ?
       AND debit_amount > 0`,
    [START_DATE, END_DATE]
  );
  const postedMap = new Map();
  for (const r of existingLedger) {
    const key = `${r.deal_number}|${new Date(r.entry_date).toISOString().slice(0, 10)}`;
    postedMap.set(key, (postedMap.get(key) || 0) + Number(r.debit_amount));
  }

  const drAccountId = await resolveAccountId(DR_ACCOUNT_CODE);
  const crAccountId = await resolveAccountId(CR_ACCOUNT_CODE);

  const toBackfill = [];
  const excludedDeals = [];
  let totalShortfall = 0;

  // Same-day-approved reductions still count for that whole day (the real EOD job
  // compares DATE(approved_at) <= DATE(systemDay), not a timestamp comparison), so
  // compare by YMD string, not Date <=.
  const ymd = (d) => new Date(d).toISOString().slice(0, 10);

  for (const deal of gsecDeals) {
    const dn = deal.deal_number;
    if (!confirmedBugDeals.has(dn)) continue; // out of scope: not hit by the confirmed bug

    const faceVal = Number(deal.face_value) || 0;
    const actualCurrentRemaining = Math.max(0, Number(deal.remaining_face_value) || 0);
    const bbEvents = (bbEventsByDeal[dn] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const sellEvents = (sellEventsByDeal[dn] || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    // Safety cross-check: our reconstructed remaining as of TODAY must match the
    // deal's actual stored remaining_face_value, or our event tracking is missing
    // some other deduction source for this deal (e.g. a mechanism outside GSec
    // Sells / buyback allocations) - in that case, skip it rather than guess.
    const sumAll = (events) => events.reduce((s, e) => s + e.amt, 0);
    const reconstructedToday = Math.max(0, faceVal - sumAll(sellEvents) - sumAll(bbEvents));
    if (Math.abs(reconstructedToday - actualCurrentRemaining) > 1) {
      excludedDeals.push({ dn, reconstructedToday, actualCurrentRemaining });
      continue;
    }

    for (const day of dates) {
      if (ymd(deal.value_date) > day) continue; // not yet bought
      if (ymd(deal.maturity_date) <= day) continue; // matured

      const sumBefore = (events) => events.reduce((s, e) => (ymd(e.date) <= day ? s + e.amt : s), 0);
      const soldAsOfDay = sumBefore(sellEvents);
      const buybackAsOfDay = sumBefore(bbEvents);
      const correctRemaining = Math.max(0, faceVal - soldAsOfDay - buybackAsOfDay);

      const correctCalc = computeGsecPerDayAccrual(
        Object.assign({}, deal, {
          remaining_face_value: correctRemaining,
          linked_sold_face_value: soldAsOfDay,
          linked_buyback_face_value: buybackAsOfDay
        }),
        day,
        2
      );
      const correctAmt = correctCalc.ok ? Number(correctCalc.amount) : 0;
      if (correctAmt <= 0) continue;

      const posted = postedMap.get(`${dn}|${day}`) || 0;
      const shortfall = Math.round((correctAmt - posted) * 100) / 100;
      if (shortfall > 0.01) {
        toBackfill.push({ dn, day, correctAmt: Number(correctAmt.toFixed(2)), posted: Number(posted.toFixed(2)), shortfall });
        totalShortfall += shortfall;
      }
    }
  }

  toBackfill.sort((a, b) => (a.dn === b.dn ? a.day.localeCompare(b.day) : a.dn.localeCompare(b.dn)));
  console.log(`\nExcluded (reconstruction mismatch vs actual remaining_face_value - needs manual review, NOT backfilled): ${excludedDeals.length}`);
  console.table(excludedDeals);
  console.log(`\nEntries needing backfill: ${toBackfill.length}`);
  console.table(toBackfill);
  console.log(`\nTOTAL SHORTFALL for ${START_DATE}..${END_DATE}: ${totalShortfall.toFixed(2)}`);

  if (!COMMIT) {
    console.log('\nDry run complete. Re-run with --commit to post these backfill entries.');
    process.exit(0);
  }

  console.log('\nPosting backfill entries...');
  let posted = 0;
  for (const item of toBackfill) {
    const description = `GSec Daily Accrual Backfill for Deal ${item.dn} (${item.day})`;
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
      [item.day, drAccountId, item.shortfall, item.dn, description]
    );
    await db.query(
      `INSERT INTO ledger_entries (entry_date, account_id, debit_amount, credit_amount, deal_number, description, currency)
       VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
      [item.day, crAccountId, item.shortfall, item.dn, description]
    );
    posted++;
  }
  console.log(`Posted ${posted} backfill entry pairs. Total amount: ${totalShortfall.toFixed(2)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e.message, e.stack);
  process.exit(1);
});
