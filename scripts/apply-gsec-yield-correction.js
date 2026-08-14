/**
 * Re-price an already final-approved GSEC deal at a corrected yield and realign its
 * posted sale ledger, in one transaction.
 *
 * Prices are recomputed with the same chain the front office form uses (Excel PRICE,
 * Actual/Actual, semi-annual), and the script refuses to run unless that chain first
 * reproduces the currently stored clean/dirty/accrued/settlement values — otherwise the
 * stored row was produced some other way and must not be machine-corrected.
 *
 * Accrued interest is yield-independent, so on the sale entry only two lines move: the
 * bank debit follows the new settlement amount, and Capital Gain absorbs the difference
 * (it is the clean-to-clean P&L plug against an unchanged carrying value).
 *
 * Usage:
 *   node scripts/apply-gsec-yield-correction.js "20260814/GSEC/0013" 10.98            # dry run
 *   node scripts/apply-gsec-yield-correction.js "20260814/GSEC/0013" 10.98 --commit
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { excelPRICE } = require('../services/excelBondPricing');
const { findCouponPeriodFromMaturity, getDaysDifference } = require('../services/gsecCouponPeriod');

const DEAL = process.argv[2];
const NEW_YIELD = Number(process.argv[3]);
const COMMIT = process.argv.includes('--commit');

const CAPITAL_GAIN_CODE = '358-101-130-398-44';

const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const money = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseLocalYMD(value) {
  const [y, m, d] = ymd(value).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Mirrors FixedIncomeGsecPage.calculatePrices + its settlement/accrued derivation. */
function priceDeal({ faceValue, couponRate, yieldRate, valueDate, maturityDate, accruedAdjustment }) {
  const frequency = 2;
  const cr = couponRate / 100;
  const settle = parseLocalYMD(valueDate);
  const maturity = parseLocalYMD(maturityDate);
  const coupon = 100 * (cr / frequency);

  const { lastCoupon, nextCoupon } = findCouponPeriodFromMaturity(settle, maturity, frequency);
  const daysInPeriod = getDaysDifference(nextCoupon, lastCoupon);
  const daysAccrued = getDaysDifference(settle, lastCoupon);

  const accruedPer100 = round4(coupon * (daysAccrued / daysInPeriod));
  const cleanPrice = round4(excelPRICE(settle, maturity, cr, yieldRate / 100, 100, frequency, 1));
  const dirtyPrice = round4(cleanPrice + accruedPer100);

  return {
    accruedPer100,
    cleanPrice,
    dirtyPrice,
    settlementAmount: Number(((faceValue * dirtyPrice) / 100).toFixed(4)),
    accruedMoney: round4((accruedPer100 * faceValue) / 100 + accruedAdjustment)
  };
}

const sum = (rows, field) => rows.reduce((s, r) => s + Number(r[field] || 0), 0);

(async () => {
  if (!DEAL || !Number.isFinite(NEW_YIELD)) {
    throw new Error('Usage: node scripts/apply-gsec-yield-correction.js "<deal number>" <yield> [--commit]');
  }

  const [[deal]] = await db.query('SELECT * FROM gsec WHERE TRIM(deal_number) = ?', [DEAL]);
  if (!deal) throw new Error(`Deal ${DEAL} not found`);

  const [[master]] = await db.query(
    'SELECT * FROM isin_master WHERE TRIM(isin_number) = ? LIMIT 1',
    [String(deal.isin_number).trim()]
  );
  if (!master || master.coupon_rate == null) {
    throw new Error(`No isin_master coupon rate for ${deal.isin_number}`);
  }

  const faceValue = Number(deal.face_value);
  const couponRate = Number(master.coupon_rate);
  const accruedAdjustment = Number(deal.accrued_interest_adjustment) || 0;
  const oldYield = Number(deal.yield);

  const priceArgs = {
    faceValue,
    couponRate,
    valueDate: deal.value_date,
    maturityDate: deal.maturity_date,
    accruedAdjustment
  };
  const before = priceDeal({ ...priceArgs, yieldRate: oldYield });
  const after = priceDeal({ ...priceArgs, yieldRate: NEW_YIELD });

  console.log('='.repeat(80));
  console.log(`${COMMIT ? 'APPLY' : 'DRY RUN'}  ${deal.deal_number}  ${deal.transaction_type}  ${deal.isin_number}`);
  console.log('='.repeat(80));
  console.log(`  face ${money(faceValue)} | value date ${ymd(deal.value_date)} | coupon ${couponRate}% | status ${deal.status}`);

  // Guard: only correct rows this pricing chain provably produced.
  const checks = [
    ['clean_price', Number(deal.clean_price), before.cleanPrice],
    ['dirty_price', Number(deal.dirty_price), before.dirtyPrice],
    ['accrued_interest', Number(deal.accrued_interest), before.accruedMoney],
    ['settlement_amount', Number(deal.settlement_amount), before.settlementAmount]
  ];
  const drift = checks.filter(([, stored, calc]) => Math.abs(stored - calc) >= 0.005);
  if (drift.length) {
    drift.forEach(([n, s, c]) => console.error(`  ${n}: stored ${s} vs recomputed ${c}`));
    throw new Error('Stored values do not match the pricing model; refusing to modify.');
  }
  console.log(`  pricing model reproduces the stored deal at yield ${oldYield.toFixed(4)} — safe to correct.`);

  console.log(`\n  yield             ${oldYield.toFixed(4)}  ->  ${NEW_YIELD.toFixed(4)}`);
  console.log(`  clean price       ${before.cleanPrice.toFixed(4)}  ->  ${after.cleanPrice.toFixed(4)}`);
  console.log(`  dirty price       ${before.dirtyPrice.toFixed(4)}  ->  ${after.dirtyPrice.toFixed(4)}`);
  console.log(`  settlement        ${money(before.settlementAmount)}  ->  ${money(after.settlementAmount)}`);
  console.log(`  accrued interest  ${money(before.accruedMoney)}  (unchanged)`);

  // --- ledger ---
  const [ledger] = await db.query(
    'SELECT * FROM ledger_entries WHERE deal_number = ? ORDER BY id',
    [deal.deal_number]
  );
  const [[cgAccount]] = await db.query(
    'SELECT id, name FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [CAPITAL_GAIN_CODE]
  );
  if (!cgAccount) throw new Error(`Capital gain account ${CAPITAL_GAIN_CODE} not found`);

  const saleLines = ledger.filter((l) => !/Accrued Interest Reversal/i.test(l.description || ''));
  const reversalLines = ledger.filter((l) => /Accrued Interest Reversal/i.test(l.description || ''));

  const oldSettlement2 = round2(before.settlementAmount);
  const bankLines = saleLines.filter((l) => round2(Number(l.debit_amount)) === oldSettlement2);
  if (bankLines.length !== 1) {
    throw new Error(`Expected exactly 1 bank debit line of ${money(oldSettlement2)}, found ${bankLines.length}`);
  }
  const bankLine = bankLines[0];

  const cgMainLines = saleLines.filter(
    (l) => l.account_id === cgAccount.id && !/\(Rounding\)/i.test(l.description || '')
  );
  if (cgMainLines.length !== 1) {
    throw new Error(`Expected exactly 1 main capital gain line, found ${cgMainLines.length}`);
  }
  const cgLine = cgMainLines[0];
  if (Number(cgLine.debit_amount) > 0) {
    throw new Error('Capital gain is currently posted as a loss (debit); this script only handles the credit side.');
  }

  const drBefore = round2(sum(saleLines, 'debit_amount'));
  const crBefore = round2(sum(saleLines, 'credit_amount'));
  if (Math.abs(drBefore - crBefore) >= 0.01) {
    throw new Error(`Sale entry is already unbalanced (DR ${money(drBefore)} vs CR ${money(crBefore)})`);
  }

  const newSettlement2 = round2(after.settlementAmount);
  const drAfter = round2(drBefore - round2(Number(bankLine.debit_amount)) + newSettlement2);
  const crOthers = round2(crBefore - round2(Number(cgLine.credit_amount)));
  const newCapitalGain = round2(drAfter - crOthers);
  if (newCapitalGain < 0) {
    throw new Error('New capital gain is negative; the line would have to flip to the debit side. Aborting.');
  }

  console.log(`\n  ledger: ${saleLines.length} sale line(s) + ${reversalLines.length} reversal line(s)`);
  console.log(`    id ${bankLine.id}  bank DR (account ${bankLine.account_id})`);
  console.log(`        ${money(bankLine.debit_amount)}  ->  ${money(newSettlement2)}`);
  console.log(`    id ${cgLine.id}  ${cgAccount.name} CR`);
  console.log(`        ${money(cgLine.credit_amount)}  ->  ${money(newCapitalGain)}`);
  console.log(`    entry totals  DR ${money(drAfter)}  CR ${money(round2(crOthers + newCapitalGain))}`);
  console.log('    all other sale lines and both reversal lines unchanged.');

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit to apply.');
    process.exit(0);
  }

  const backupDir = path.join(__dirname, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `${deal.deal_number.replace(/\//g, '-')}-yield-${new Date().toISOString().replace(/[:.]/g, '')}.json`
  );
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ takenAt: new Date().toISOString(), newYield: NEW_YIELD, gsec: deal, ledger }, null, 2),
    'utf8'
  );
  console.log(`\n  backup written: ${backupPath}`);

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [g] = await conn.query(
      `UPDATE gsec SET \`yield\` = ?, clean_price = ?, dirty_price = ?, settlement_amount = ?, updated_at = NOW()
       WHERE id = ?`,
      [NEW_YIELD, after.cleanPrice, after.dirtyPrice, after.settlementAmount, deal.id]
    );
    const [b] = await conn.query(
      'UPDATE ledger_entries SET debit_amount = ?, updated_at = NOW() WHERE id = ?',
      [newSettlement2, bankLine.id]
    );
    const [c] = await conn.query(
      'UPDATE ledger_entries SET credit_amount = ?, updated_at = NOW() WHERE id = ?',
      [newCapitalGain, cgLine.id]
    );
    if (g.affectedRows !== 1 || b.affectedRows !== 1 || c.affectedRows !== 1) {
      throw new Error(`Unexpected affected rows: gsec ${g.affectedRows}, bank ${b.affectedRows}, gain ${c.affectedRows}`);
    }

    // Re-read inside the transaction and prove the entry still balances before committing.
    const [verifyLedger] = await conn.query(
      'SELECT * FROM ledger_entries WHERE deal_number = ? ORDER BY id',
      [deal.deal_number]
    );
    const vSale = verifyLedger.filter((l) => !/Accrued Interest Reversal/i.test(l.description || ''));
    const vDr = round2(sum(vSale, 'debit_amount'));
    const vCr = round2(sum(vSale, 'credit_amount'));
    if (Math.abs(vDr - vCr) >= 0.01) {
      throw new Error(`Post-update sale entry unbalanced: DR ${money(vDr)} vs CR ${money(vCr)}`);
    }

    const [[vDeal]] = await conn.query('SELECT * FROM gsec WHERE id = ?', [deal.id]);
    if (round2(Number(vDeal.settlement_amount)) !== newSettlement2) {
      throw new Error('Post-update settlement amount mismatch');
    }

    await conn.commit();
    console.log(`\n  COMMITTED. Sale entry balances at DR ${money(vDr)} = CR ${money(vCr)}.`);
  } catch (err) {
    await conn.rollback();
    console.error('\n  ROLLED BACK:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
  }

  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
