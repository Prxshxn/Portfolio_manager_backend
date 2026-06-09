/* eslint-disable no-console */
'use strict';

/**
 * Clean-slate removal of the mistaken Buy deal 20260608/GSEC/0007 and its linked
 * sell/buy buyback BB20260608005 (incl. leg2 forward Buy holding), so they can be
 * re-entered fresh via the UI. Safe pre-EOD: these deals have future value dates
 * and have NO EOD-generated postings.
 *
 * Removes (resolved dynamically): gsec buy row, gsec leg2 forward row, buyback row,
 * their ledger entries, and their cashflow_transactions. Runs in one transaction.
 */

const { pool } = require('../config/database');

const DEAL = '20260608/GSEC/0007';
const BUYBACK = 'BB20260608005';

function ymd(d){return d?new Date(d).toISOString().slice(0,10):'(null)';}

(async () => {
  const conn = await pool.getConnection();
  try {
    // ---- Resolve targets ----
    const [buyRows] = await conn.query(
      `SELECT id, deal_number, face_value, value_date FROM gsec WHERE deal_number=? AND transaction_type='Buy'`,
      [DEAL]
    );
    const [bbRows] = await conn.query(`SELECT id, deal_number FROM buyback_deals WHERE deal_number=?`, [BUYBACK]);
    const bbId = bbRows[0] && bbRows[0].id;
    let fwdRows = [];
    if (bbId) {
      [fwdRows] = await conn.query(`SELECT id, deal_number FROM gsec WHERE buyback_deal_id=?`, [bbId]);
    }

    const buyId = buyRows[0] && buyRows[0].id;
    const fwdIds = fwdRows.map(r => r.id);
    const fwdDealNos = fwdRows.map(r => r.deal_number);

    console.log('Resolved targets:');
    console.log('  buy gsec:', buyId ? `id=${buyId} (${DEAL})` : 'NOT FOUND');
    console.log('  buyback :', bbId ? `id=${bbId} (${BUYBACK})` : 'NOT FOUND');
    console.log('  leg2 fwd:', fwdRows.length ? fwdRows.map(r => `id=${r.id} (${r.deal_number})`).join(', ') : 'none');

    // ---- Safety: ensure no EOD-generated postings exist ----
    const [eod] = await conn.query(
      `SELECT COUNT(*) AS n FROM ledger_entries
       WHERE (TRIM(deal_number)=? OR deal_number LIKE ? ${fwdDealNos.length ? 'OR TRIM(deal_number) IN (?)' : ''})
         AND (description LIKE 'GSec Daily Accrual%' OR description LIKE 'GSec Daily Amortization%'
              OR description LIKE 'GSec Coupon Settlement%' OR description LIKE 'GSec Maturity%')`,
      fwdDealNos.length ? [DEAL, `${BUYBACK}%`, fwdDealNos] : [DEAL, `${BUYBACK}%`]
    );
    if (eod[0].n > 0) {
      console.log(`\nABORT: ${eod[0].n} EOD-generated ledger line(s) exist. Not safe to bulk-delete.`);
      conn.release();
      process.exit(1);
    }

    await conn.beginTransaction();

    // ---- 1) Ledger entries ----
    const ledgerDealNos = [DEAL, ...fwdDealNos];
    const [delLedgerDirect] = await conn.query(
      `DELETE FROM ledger_entries WHERE TRIM(deal_number) IN (?)`, [ledgerDealNos]
    );
    const [delLedgerBB] = await conn.query(
      `DELETE FROM ledger_entries WHERE deal_number LIKE ?`, [`${BUYBACK}%`]
    );
    console.log(`\nDeleted ledger lines: ${delLedgerDirect.affectedRows} (deal nos) + ${delLedgerBB.affectedRows} (buyback synthetics)`);

    // ---- 2) Cashflow transactions ----
    let cfDeleted = 0;
    const cfIds = [buyId, ...fwdIds].filter(Boolean);
    for (const id of cfIds) {
      const [r] = await conn.query(`DELETE FROM cashflow_transactions WHERE reference_number LIKE ?`, [`GSEC-${id}%`]);
      cfDeleted += r.affectedRows;
    }
    console.log(`Deleted cashflow_transactions: ${cfDeleted}`);

    // ---- 3) gsec rows (buy + leg2 forward) ----
    const gsecIds = [buyId, ...fwdIds].filter(Boolean);
    let gsecDeleted = 0;
    if (gsecIds.length) {
      const [r] = await conn.query(`DELETE FROM gsec WHERE id IN (?)`, [gsecIds]);
      gsecDeleted = r.affectedRows;
    }
    console.log(`Deleted gsec rows: ${gsecDeleted} (ids ${gsecIds.join(', ')})`);

    // ---- 4) buyback row ----
    let bbDeleted = 0;
    if (bbId) {
      const [r] = await conn.query(`DELETE FROM buyback_deals WHERE id = ?`, [bbId]);
      bbDeleted = r.affectedRows;
    }
    console.log(`Deleted buyback_deals: ${bbDeleted} (id ${bbId})`);

    await conn.commit();

    // ---- Verify ----
    console.log('\n--- Verification (should all be 0/none) ---');
    const [vBuy] = await conn.query(`SELECT COUNT(*) n FROM gsec WHERE deal_number=?`, [DEAL]);
    const [vFwd] = await conn.query(`SELECT COUNT(*) n FROM gsec WHERE buyback_deal_id=?`, [bbId]);
    const [vBB] = await conn.query(`SELECT COUNT(*) n FROM buyback_deals WHERE deal_number=?`, [BUYBACK]);
    const [vLe] = await conn.query(`SELECT COUNT(*) n FROM ledger_entries WHERE TRIM(deal_number)=? OR deal_number LIKE ?`, [DEAL, `${BUYBACK}%`]);
    console.log(`  gsec ${DEAL}: ${vBuy[0].n}`);
    console.log(`  gsec leg2 forward (buyback_deal_id=${bbId}): ${vFwd[0].n}`);
    console.log(`  buyback ${BUYBACK}: ${vBB[0].n}`);
    console.log(`  related ledger lines: ${vLe[0].n}`);

    console.log('\nDONE. Clean slate. You can now re-enter the Buy deal (face 57,720,552) and then the sell/buy via the UI.');
    conn.release();
    process.exit(0);
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('Error (rolled back):', e);
    process.exit(1);
  }
})();
