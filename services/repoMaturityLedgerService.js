'use strict';

/**
 * Repo / Reverse Repo maturity (and premature-maturity) ledger posting.
 *
 * Repo (borrowing) is three balanced pairs:
 *   1. DR Interest Payable 780 / CR Accrual expense 752   = interest_amount
 *   2. DR Repo liability 308   / CR Bank                  = principal
 *   3. DR Maturity expense 768 / CR Bank                  = interest_amount
 *
 * Reverse Repo (asset) is a single pair:
 *   DR Bank / CR Reverse Repo asset = principal + interest
 *
 * Shared by EOD and Premature Maturity so both produce the same journal.
 * Idempotent: skips if a maturity description already exists for the deal.
 */

const db = require('../config/database');
const accountMapping = require('./accountMappingService');
const { postLedgerEntry } = require('../controllers/ledgerController');
const { resolveRepoDealNumber } = require('../models/repoDealModel');

function isOk(result) {
  return result && result.success === true;
}

function toYmd(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function resolveBankCode(settlementMode) {
  if (!settlementMode) return null;
  const [rows] = await db.query(
    'SELECT ledger_account_code FROM settlement_accounts WHERE bank_payment_code = ? LIMIT 1',
    [settlementMode]
  );
  return (rows[0] && rows[0].ledger_account_code) || null;
}

async function hasMaturityLedger(dealNumber, dealType) {
  const like =
    dealType === 'Reverse Repo'
      ? 'Reverse Repo Maturity - Deal %'
      : 'Repo Maturity - Deal %';
  const [rows] = await db.query(
    `SELECT 1 FROM ledger_entries
     WHERE deal_number = ? AND description LIKE ?
     LIMIT 1`,
    [dealNumber, like]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function markMatured(dealId) {
  await db.query("UPDATE repo_deals SET matured = 1, status = 'Matured' WHERE id = ?", [dealId]);
}

/**
 * @param {object} deal - repo_deals row (needs id, deal_number, deal_type, principal_amount,
 *   interest_amount, settlement_mode, maturity_date)
 * @param {{ entryDate?: string }} [options]
 * @returns {Promise<{success:boolean, posted:boolean, skipped?:string, error?:string}>}
 */
async function postRepoMaturityLedger(deal, { entryDate } = {}) {
  const dealNumber = resolveRepoDealNumber(deal);
  const dealType = deal.deal_type || 'Repo';
  const date = toYmd(entryDate || deal.maturity_date);
  if (!dealNumber || !date) {
    return { success: false, posted: false, error: 'missing deal number or entry date' };
  }

  if (await hasMaturityLedger(dealNumber, dealType)) {
    if (deal.id != null) await markMatured(deal.id);
    return { success: true, posted: false, skipped: 'already_posted' };
  }

  const bankAccount = await resolveBankCode(deal.settlement_mode);
  if (!bankAccount) {
    return { success: false, posted: false, error: 'no settlement bank account resolved' };
  }

  const principalAmount = Number(deal.principal_amount) || 0;
  const interestAmount = Number(deal.interest_amount) || 0;
  const maturityAmount = principalAmount + interestAmount;

  if (dealType === 'Reverse Repo') {
    const repoAsset = await accountMapping.getAccountCode(
      accountMapping.MAPPING_KEYS.REPO_REVERSE_REPO_ASSET
    );
    const lr = await postLedgerEntry({
      date,
      dr_account: bankAccount,
      cr_account: repoAsset,
      amount: maturityAmount,
      deal_id: dealNumber,
      description: `Reverse Repo Maturity - Deal ${dealNumber}`
    });
    if (!isOk(lr)) return { success: false, posted: false, error: lr && lr.error };
    if (deal.id != null) await markMatured(deal.id);
    return { success: true, posted: true };
  }

  if (dealType !== 'Repo') {
    return { success: false, posted: false, error: `unsupported deal_type=${dealType}` };
  }

  const [liabilityAccount, interestPayable, accrualInterestExpense, maturityInterestExpense] =
    await Promise.all([
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_LIABILITY),
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_PAYABLE),
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_INTEREST_EXPENSE),
      accountMapping.getAccountCode(accountMapping.MAPPING_KEYS.REVERSE_REPO_MATURITY_INTEREST_EXPENSE)
    ]);

  const description = `Repo Maturity - Deal ${dealNumber}`;
  const reversalDescription = `Repo Interest Accrual Reversal - Deal ${dealNumber}`;

  if (interestAmount > 0) {
    const reversal = await postLedgerEntry({
      date,
      dr_account: interestPayable,
      cr_account: accrualInterestExpense,
      amount: interestAmount,
      deal_id: dealNumber,
      description: reversalDescription
    });
    if (!isOk(reversal)) return { success: false, posted: false, error: reversal && reversal.error };
  }

  if (principalAmount > 0) {
    const principalLeg = await postLedgerEntry({
      date,
      dr_account: liabilityAccount,
      cr_account: bankAccount,
      amount: principalAmount,
      deal_id: dealNumber,
      description
    });
    if (!isOk(principalLeg)) {
      return { success: false, posted: false, error: principalLeg && principalLeg.error };
    }
  }

  if (interestAmount > 0) {
    const interestLeg = await postLedgerEntry({
      date,
      dr_account: maturityInterestExpense,
      cr_account: bankAccount,
      amount: interestAmount,
      deal_id: dealNumber,
      description
    });
    if (!isOk(interestLeg)) {
      return { success: false, posted: false, error: interestLeg && interestLeg.error };
    }
  }

  if (deal.id != null) await markMatured(deal.id);
  return { success: true, posted: true };
}

module.exports = {
  postRepoMaturityLedger,
  hasRepoMaturityLedger: hasMaturityLedger,
  resolveRepoMaturityBankCode: resolveBankCode
};
