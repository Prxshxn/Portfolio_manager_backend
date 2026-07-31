/* eslint-disable no-console */
const db = require('../config/database');
const Gsec = require('../models/gsec');
const { computeGsecPerDayAccrual } = require('../services/gsecCouponPeriod');

const AS_AT = '2026-06-24';
const TODAY = '2026-06-25';
const EXECUTE = process.argv.includes('--execute');
const DEALS = ['20260601/GSEC/0008', '20260615/GSEC/0009'];

const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

async function soldAgainst(dealNumber, asAt) {
  const [r] = await db.query(
    `SELECT COALESCE(SUM(face_value),0) AS s FROM gsec
     WHERE transaction_type='Sell' AND TRIM(buy_deal_number)=TRIM(?)
       AND status <> 'rejected'
       AND value_date IS NOT NULL AND DATE(value_date)<=DATE(?)`,
    [dealNumber, asAt]
  );
  return num(r[0]?.s);
}

/** All non-rejected sells allocated to the buy (creation-time lock), any value date. */
async function soldAllocated(dealNumber) {
  const [r] = await db.query(
    `SELECT COALESCE(SUM(face_value),0) AS s FROM gsec
     WHERE transaction_type='Sell' AND TRIM(buy_deal_number)=TRIM(?)
       AND status <> 'rejected'`,
    [dealNumber]
  );
  return num(r[0]?.s);
}

async function buybackAgainst(dealNumber, asAt) {
  let total = 0;
  const [direct] = await db.query(
    `SELECT COALESCE(SUM(leg1_face_value),0) AS bb FROM buyback_deals
     WHERE deal_status='Approved' AND TRIM(source_buy_deal_number)=TRIM(?)
       AND leg1_transaction_type='Sell' AND approved_at IS NOT NULL AND DATE(approved_at)<=DATE(?)`,
    [dealNumber, asAt]
  );
  total += num(direct[0]?.bb);
  const [allocRows] = await db.query(
    `SELECT sell_deal_allocations FROM buyback_deals
     WHERE deal_status='Approved' AND sell_deal_allocations IS NOT NULL
       AND leg1_transaction_type='Sell' AND approved_at IS NOT NULL AND DATE(approved_at)<=DATE(?)`,
    [asAt]
  );
  for (const row of allocRows) {
    try {
      const allocs = typeof row.sell_deal_allocations === 'string'
        ? JSON.parse(row.sell_deal_allocations)
        : row.sell_deal_allocations;
      if (!Array.isArray(allocs)) continue;
      for (const a of allocs) {
        if (String(a.deal_number || '').trim() === dealNumber) total += num(a.amountToSell);
      }
    } catch (_) { /* ignore */ }
  }
  return total;
}

async function gsecBuyRow(dn) {
  const [r] = await db.query(
    `SELECT g.*, im.coupon_rate, im.coupon_date_1, im.coupon_date_2
     FROM gsec g
     LEFT JOIN isin_master im
       ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
     WHERE g.deal_number=? AND g.transaction_type='Buy' LIMIT 1`,
    [dn]
  );
  return r[0];
}

async function acctIds() {
  const [drRows] = await db.query(
    `SELECT account_id FROM ledger_entries
     WHERE description LIKE 'GSec Daily Accrual%' AND debit_amount > 0 LIMIT 1`
  );
  const [crRows] = await db.query(
    `SELECT account_id FROM ledger_entries
     WHERE description LIKE 'GSec Daily Accrual%' AND credit_amount > 0 LIMIT 1`
  );
  if (!drRows.length || !crRows.length) throw new Error('Could not resolve GSec Daily Accrual account ids');
  return { drId: drRows[0].account_id, crId: crRows[0].account_id };
}

(async () => {
  const realLog = console.log;
  console.log = () => {};
  const rep = await require('../services/gsecReportService').getGsecReport({ asAtDate: AS_AT });
  console.log = realLog;
  const reportByDeal = new Map((rep.data || []).map((r) => [String(r.deal_number).trim(), num(r.daily_accrual)]));

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Retro accrual date: ${AS_AT}\n`);

  const changes = [];
  for (const dn of DEALS) {
    const g = await gsecBuyRow(dn);
    if (!g) throw new Error(`Missing buy deal ${dn}`);

    const sold = await soldAgainst(dn, AS_AT);
    const bb = await buybackAgainst(dn, AS_AT);
    const targetRfv = Math.max(0, num(g.face_value) - sold - bb);

    const acc = computeGsecPerDayAccrual(
      { ...g, remaining_face_value: targetRfv, linked_sold_face_value: sold, linked_buyback_face_value: bb },
      AS_AT,
      2
    );
    const amount = acc.ok ? acc.amount : 0;
    const reportAmt = reportByDeal.get(dn) ?? 0;

    const soldToday = await soldAllocated(dn);
    const bbToday = await buybackAgainst(dn, TODAY);
    const rfvToday = Math.max(0, num(g.face_value) - soldToday - bbToday);
    const accToday = computeGsecPerDayAccrual(
      { ...g, remaining_face_value: rfvToday, linked_sold_face_value: soldToday, linked_buyback_face_value: bbToday },
      TODAY,
      2
    );

    console.log(dn);
    console.log(`  stored RFV: ${num(g.remaining_face_value).toLocaleString()}`);
    console.log(`  RFV as at ${AS_AT}: ${targetRfv.toLocaleString()} (sold=${sold.toLocaleString()} bb=${bb.toLocaleString()})`);
    console.log(`  accrual ${AS_AT}: computed=${amount.toFixed(8)} report=${reportAmt.toFixed(8)}`);
    console.log(`  RFV as at ${TODAY}: ${rfvToday.toLocaleString()} per_day_accrual today=${accToday.ok ? accToday.amount.toFixed(8) : '0'}`);

    changes.push({
      dn,
      id: g.id,
      targetRfv,
      rfvToday,
      perDayToday: accToday.ok ? accToday.amount : 0,
      EToday: accToday.ok ? accToday.E : null,
      retroAmount: amount,
      E: acc.ok ? acc.E : null
    });
  }

  const [posted] = await db.query(
    `SELECT COALESCE(SUM(debit_amount),0) AS t FROM ledger_entries
     WHERE DATE(entry_date)=DATE(?) AND description LIKE 'GSec Daily Accrual%' AND debit_amount>0`,
    [AS_AT]
  );
  const retroSum = changes.reduce((s, c) => s + c.retroAmount, 0);
  console.log(`\nPosted GSec accrual ${AS_AT} now: ${num(posted[0]?.t).toFixed(2)}`);
  console.log(`After retro add: ${(num(posted[0]?.t) + retroSum).toFixed(2)} (target 609116.71)`);

  if (!EXECUTE) {
    console.log('\nDRY-RUN. Re-run with --execute to apply.');
    process.exit(0);
  }

  const { drId, crId } = await acctIds();

  for (const c of changes) {
    await db.query(
      `UPDATE gsec SET remaining_face_value = ?, per_day_accrual = ?, number_of_days_for_coupon_period = ?, updated_at = NOW()
       WHERE id = ?`,
      [c.rfvToday.toFixed(4), c.perDayToday, c.EToday, c.id]
    );
    try { await Gsec.syncFutureCouponCashflowsForBuyDeal(c.dn); } catch (e) {
      console.warn(`cashflow sync ${c.dn}: ${e.message}`);
    }

    const [exists] = await db.query(
      `SELECT 1 FROM ledger_entries WHERE TRIM(deal_number)=? AND DATE(entry_date)=DATE(?)
         AND description LIKE 'GSec Daily Accrual%' LIMIT 1`,
      [c.dn, AS_AT]
    );
    if (!exists.length && c.retroAmount > 0) {
      const desc = `GSec Daily Accrual for Deal ${c.dn}`;
      await db.query(
        `INSERT INTO ledger_entries (entry_date,account_id,debit_amount,credit_amount,deal_number,description,currency)
         VALUES (?, ?, ?, 0, ?, ?, 'LKR')`,
        [AS_AT, drId, c.retroAmount, c.dn, desc]
      );
      await db.query(
        `INSERT INTO ledger_entries (entry_date,account_id,debit_amount,credit_amount,deal_number,description,currency)
         VALUES (?, ?, 0, ?, ?, ?, 'LKR')`,
        [AS_AT, crId, c.retroAmount, c.dn, desc]
      );
      console.log(`Posted ${AS_AT} accrual ${c.retroAmount.toFixed(2)} for ${c.dn}`);
    }
  }

  const [posted2] = await db.query(
    `SELECT COALESCE(SUM(debit_amount),0) AS t FROM ledger_entries
     WHERE DATE(entry_date)=DATE(?) AND description LIKE 'GSec Daily Accrual%' AND debit_amount>0`,
    [AS_AT]
  );
  console.log(`\nPosted GSec accrual ${AS_AT} now: ${num(posted2[0]?.t).toFixed(2)}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
