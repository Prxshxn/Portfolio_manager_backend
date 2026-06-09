/**
 * Backfill purchase ledger entries for BUYBACK LEG-2 BUY deals.
 *
 * Scope (per product decision):
 *   - transaction_type = 'Buy'
 *   - status           = 'final_approved'
 *   - buyback_deal_id IS NOT NULL            (buyback leg-2 buys only)
 *   - value_date >= 2026-06-01               (window lower bound)
 *   - value_date <= system_day               (DEFER future-dated deals)
 *   - no existing ledger_entries for the deal_number (missing only)
 *
 * Entry date  = deal.value_date (matches production posting).
 * Go-forward  = unchanged; the EOD leg-2 block continues to post new deals on value date.
 *
 * SAFETY: dry-run by default. Pass --commit to actually post.
 * Commit posts via the SAME service the EOD job uses (postFinalApprovedBuyLedger),
 * so backfilled entries are identical to production.
 */
const db = require('../config/database');
const accountMapping = require('../services/accountMappingService');
const { getSystemDay } = require('../models/systemDayModel');
const { postFinalApprovedBuyLedger } = require('../services/gsecApprovalLedgerService');

const WINDOW_START = process.env.WINDOW_START || '2026-06-01';
const COMMIT = process.argv.includes('--commit');
const DEFAULT_GSEC_BANK_LEDGER_CODE = '131-101-410-164-44';
const truncate8 = (x) => Math.floor(Number(x) * 100000000) / 100000000;
const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function acctName(code) {
  if (!code) return '(unmapped)';
  try {
    const [r] = await db.query(`SELECT name FROM chart_of_accounts WHERE account_code = ? LIMIT 1`, [code]);
    return r && r[0] ? r[0].name : '(name not found)';
  } catch (_) { return '(lookup failed)'; }
}

async function computeJournal(t, bbPrefix) {
  const faceVal = Number(t.face_value || 0);
  const buyClean = Number(t.clean_price || 0);
  const buyDirty = Number(t.dirty_price || 0);
  let accruedInterest = Number(t.accrued_interest || 0);
  let netAmount = 0;
  let bankTotal = Number(t.settlement_amount || t.face_value || 0);
  if (faceVal > 0 && buyClean > 0 && buyDirty > 0 && buyDirty >= buyClean) {
    accruedInterest = truncate8(((buyDirty - buyClean) * faceVal) / 100);
    netAmount = truncate8((buyClean * faceVal) / 100);
    bankTotal = truncate8((buyDirty * faceVal) / 100);
  } else {
    if (!accruedInterest && bankTotal > 0) accruedInterest = 0;
    netAmount = truncate8(bankTotal - accruedInterest);
  }
  const treasuryCode = (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_TRADING_ACCOUNT)) || '131-101-350-098-44';
  const accruedCode = (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_ACCRUED_INTEREST_PAID)) || '131-101-350-128-44';
  let bankCode = (await accountMapping.getAccountCodeOptional(accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT)) || DEFAULT_GSEC_BANK_LEDGER_CODE;
  let bankSource = 'default';
  if (t.settlement_mode) {
    const [sa] = await db.query('SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1', [t.settlement_mode]);
    if (sa && sa.length && sa[0].ledger_account_code) { bankCode = sa[0].ledger_account_code; bankSource = `settlement_accounts[${t.settlement_mode}]`; }
    else bankSource = `no row for '${t.settlement_mode}' -> fallback ${bankCode}`;
  }
  return { faceVal, buyClean, buyDirty, accruedInterest, netAmount, bankTotal, treasuryCode, accruedCode, bankCode, bankSource };
}

(async () => {
  try {
    const sd = await getSystemDay();
    if (!sd || !sd.system_date) { console.error('System day not set; aborting.'); process.exit(1); }
    const systemDay = new Date(sd.system_date).toISOString().slice(0, 10);

    console.log(`\n=== Buyback leg-2 BUY backfill ${COMMIT ? '(COMMIT - WILL WRITE)' : '(DRY RUN - no writes)'} ===`);
    console.log(`Window: value_date >= ${WINDOW_START} AND value_date <= system_day (${systemDay})\n`);

    const [deals] = await db.query(
      `SELECT g.*, bd.deal_number AS buyback_deal_number
       FROM gsec g
       INNER JOIN buyback_deals bd ON bd.id = g.buyback_deal_id
       WHERE g.transaction_type = 'Buy'
         AND g.status = 'final_approved'
         AND g.buyback_deal_id IS NOT NULL
         AND g.value_date IS NOT NULL
        AND DATE(g.value_date) >= DATE(?)
        AND DATE(g.value_date) <= DATE(?)
        AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci AND le.description LIKE '%GSec Purchase%')
       ORDER BY g.value_date, g.id`,
      [WINDOW_START, systemDay]
    );

    // Always show future-dated leg-2 buys that are intentionally deferred (transparency).
    const [future] = await db.query(
      `SELECT g.deal_number, g.value_date
       FROM gsec g
       WHERE g.transaction_type='Buy' AND g.status='final_approved' AND g.buyback_deal_id IS NOT NULL
        AND DATE(g.value_date) > DATE(?)
        AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.deal_number COLLATE utf8mb4_unicode_ci = g.deal_number COLLATE utf8mb4_unicode_ci AND le.description LIKE '%GSec Purchase%')
       ORDER BY g.value_date`, [systemDay]);

    if (!deals.length) {
      console.log('No matching deals require backfill. (Either none in window, or all already posted.)');
      if (future.length) {
        console.log(`\nDeferred (future value_date, will auto-post on value date): ${future.length}`);
        future.forEach(f => console.log(`  ${f.deal_number}  value_date=${String(f.value_date).slice(0,10)}`));
      }
      process.exit(0);
    }

    let grandDr = 0, grandCr = 0, posted = 0, failed = 0;
    for (const t of deals) {
      const bbNum = t.buyback_deal_number != null ? String(t.buyback_deal_number) : '';
      const bbPrefix = bbNum ? `Buyback ${bbNum} - ` : 'Buyback - ';
      const j = await computeJournal(t, bbPrefix);
      const postDate = new Date(t.value_date).toISOString().slice(0, 10);
      grandDr += j.netAmount + j.accruedInterest;
      grandCr += j.bankTotal;

      console.log(`\n----- ${t.deal_number} (gsec id ${t.id}) | buyback ${bbNum} | value_date ${postDate} -----`);
      console.log(`  Face ${fmt(j.faceVal)}  Clean ${j.buyClean}  Dirty ${j.buyDirty}  | bank acct: ${j.bankSource}`);
      console.log(`  DR ${j.treasuryCode} ${await acctName(j.treasuryCode)}  ${fmt(j.netAmount)}`);
      console.log(`  DR ${j.accruedCode} ${await acctName(j.accruedCode)}  ${fmt(j.accruedInterest)}`);
      console.log(`  CR ${j.bankCode} ${await acctName(j.bankCode)}  ${fmt(j.bankTotal)}`);
      console.log(`  Balanced: ${Math.abs((j.netAmount + j.accruedInterest) - j.bankTotal) < 0.005}  | stored settlement_amount ${fmt(Number(t.settlement_amount || 0))}`);

      if (COMMIT) {
        // Re-check no PURCHASE entry exists (guard against concurrent EOD run), then post via production service.
        // NOTE: must check specifically for the purchase entry, not any ledger row, because daily
        // accrual/amortization entries share the same deal_number and would otherwise block posting.
        const [chk] = await db.query(
          `SELECT COUNT(*) AS c FROM ledger_entries
           WHERE deal_number = ? AND description LIKE '%GSec Purchase%'`,
          [t.deal_number]
        );
        if (chk[0].c > 0) { console.log('  SKIP (purchase entry appeared since scan).'); continue; }
        const res = await postFinalApprovedBuyLedger(t, { descriptionPrefix: bbPrefix });
        if (res && res.success) { posted++; console.log('  POSTED.'); }
        else { failed++; console.log(`  FAILED: ${res && res.error}`); }
      }
    }

    console.log(`\n=========================================================`);
    console.log(`Deals in scope: ${deals.length}`);
    console.log(`Total DR ${fmt(grandDr)}   Total CR ${fmt(grandCr)}`);
    if (COMMIT) console.log(`Posted: ${posted}   Failed: ${failed}`);
    else console.log(`DRY RUN - nothing written. Re-run with --commit to post.`);
    if (future.length) {
      console.log(`\nDeferred (future value_date > ${systemDay}, will auto-post on value date): ${future.length}`);
      future.forEach(f => console.log(`  ${f.deal_number}  value_date=${String(f.value_date).slice(0,10)}`));
    }
    console.log(`=========================================================\n`);
  } catch (e) {
    console.error('ERROR:', e.message, e.stack);
  } finally {
    process.exit(0);
  }
})();
