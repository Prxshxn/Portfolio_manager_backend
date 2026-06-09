/**
 * Re-post buyback leg1 (GSec Sale) ledger entries through the corrected
 * postFinalApprovedSellLedger logic (same-day exits route accrued to 458,
 * skip coupon-income/reversal and amortisation).
 *
 * Deletes existing "GSec Sale - Final Approval" and "GSec Sale - Accrued Interest
 * Reversal" ledger lines for each synthetic leg1 deal number, then re-posts.
 *
 * Usage: node scripts/repost-buyback-sell-ledger.js BB20260602001 BB20260601001
 */
const db = require('../config/database');
const { postFinalApprovedSellLedger, truncate8 } = require('../services/gsecApprovalLedgerService');

const BBS = process.argv.slice(2);
if (!BBS.length) {
  console.error('Provide at least one buyback deal number.');
  process.exit(1);
}

async function repostOne(bb) {
  console.log(`\n=== ${bb} ===`);
  const [rows] = await db.query(
    `SELECT deal_number, leg1_value_date, leg1_trade_date, leg1_face_value, leg1_adjusted_face_value,
            leg1_settlement_amount, leg1_accrued_interest, leg1_clean_price, leg1_dirty_price,
            leg1_settlement_mode, source_buy_deal_number, sell_deal_allocations
     FROM buyback_deals WHERE deal_number = ? LIMIT 1`,
    [bb]
  );
  if (!rows.length) { console.log('  (no buyback_deals row) — skipped'); return; }
  const d = rows[0];

  let allocs = d.sell_deal_allocations;
  if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch { allocs = null; } }

  const leg1Den = parseFloat(
    d.leg1_adjusted_face_value !== null && d.leg1_adjusted_face_value !== undefined
      ? d.leg1_adjusted_face_value
      : d.leg1_face_value
  ) || 0;
  const leg1Settlement = parseFloat(d.leg1_settlement_amount) || 0;
  const leg1Accrued = parseFloat(d.leg1_accrued_interest) || 0;

  const slices = [];
  if (Array.isArray(allocs) && allocs.length) {
    for (const a of allocs) {
      const dn = a.deal_number;
      const amt = parseFloat(a.amountToSell || 0);
      if (dn && amt > 0) slices.push({ buyDealNumber: dn, faceSlice: amt, synthetic: `${bb}/BB-L1/${dn}` });
    }
  } else if (d.source_buy_deal_number && leg1Den > 0) {
    slices.push({ buyDealNumber: d.source_buy_deal_number, faceSlice: leg1Den, synthetic: `${bb}/BB-L1/${d.source_buy_deal_number}` });
  }

  for (const s of slices) {
    // Delete prior leg1 sell ledger lines for this synthetic deal number.
    const [del] = await db.query(
      `DELETE FROM ledger_entries
       WHERE deal_number = ?
         AND (description LIKE '%GSec Sale - Final Approval%'
              OR description LIKE '%GSec Sale - Accrued Interest Reversal%')`,
      [s.synthetic]
    );
    console.log(`  ${s.synthetic}: deleted ${del.affectedRows} old line(s)`);

    const ratio = leg1Den > 0 ? s.faceSlice / leg1Den : 1;
    const sliceSettlement = truncate8(leg1Settlement * ratio);
    const sliceAccrued = truncate8(leg1Accrued * ratio);

    const sellLike = {
      deal_number: s.synthetic,
      buy_deal_number: s.buyDealNumber,
      face_value: s.faceSlice,
      settlement_amount: sliceSettlement,
      accrued_interest: sliceAccrued,
      clean_price: d.leg1_clean_price,
      dirty_price: d.leg1_dirty_price,
      settlement_mode: d.leg1_settlement_mode,
      value_date: d.leg1_value_date,
      trade_date: d.leg1_trade_date || d.leg1_value_date,
      transaction_type: 'Sell'
    };

    const r = await postFinalApprovedSellLedger(sellLike, { descriptionPrefix: `Buyback ${bb} - ` });
    console.log(`  ${s.synthetic}: re-post ${r.success ? 'OK' : 'FAILED: ' + r.error}`);

    const [entries] = await db.query(
      `SELECT le.id, le.debit_amount, le.credit_amount, coa.account_code, le.description
       FROM ledger_entries le LEFT JOIN chart_of_accounts coa ON le.account_id = coa.id
       WHERE le.deal_number = ? ORDER BY le.id`, [s.synthetic]);
    let dr = 0, cr = 0;
    entries.forEach(e => {
      dr += Number(e.debit_amount); cr += Number(e.credit_amount);
      console.log(`    [${e.account_code}] DR=${e.debit_amount} CR=${e.credit_amount}`);
    });
    console.log(`    TOT DR=${truncate8(dr)} CR=${truncate8(cr)} diff=${truncate8(dr - cr)}`);
  }
}

async function main() {
  for (const bb of BBS) {
    try { await repostOne(bb); }
    catch (e) { console.error(`  ERROR for ${bb}:`, e.message); }
  }
  process.exit(0);
}
main();
