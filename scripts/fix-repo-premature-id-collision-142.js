/**
 * Fix collateral damage from premature-maturity ID collision:
 * 1) Restore gsec id=142 maturity_date (was wrongly set to 2026-08-12)
 * 2) Premature-mature repo_deals id=142 to 2026-08-12 as originally requested
 *
 *   node scripts/fix-repo-premature-id-collision-142.js
 *   node scripts/fix-repo-premature-id-collision-142.js --execute
 */
const db = require('../config/database');

const EXECUTE = process.argv.includes('--execute');
const REPO_ID = 142;
const GSEC_ID = 142;
const DATE = '2026-08-12';

(async () => {
  console.log(EXECUTE ? 'MODE: EXECUTE\n' : 'MODE: DRY-RUN\n');

  const [repoRows] = await db.query(
    `SELECT id, deal_number, maturity_date, value_date, principal_amount, interest_amount, maturity_amount, approval_status, matured
       FROM repo_deals WHERE id = ?`,
    [REPO_ID]
  );
  const repo = repoRows[0];
  if (!repo) throw new Error('Repo deal 142 not found');

  const [gsecRows] = await db.query(
    `SELECT g.id, g.deal_number, g.maturity_date, g.isin_number, im.maturity_date AS isin_maturity
       FROM gsec g
       LEFT JOIN isin_master im
         ON g.isin_number COLLATE utf8mb4_unicode_ci = im.isin_number COLLATE utf8mb4_unicode_ci
      WHERE g.id = ?`,
    [GSEC_ID]
  );
  const gsec = gsecRows[0];
  if (!gsec) throw new Error('GSEC deal 142 not found');

  const restoreMaturity = gsec.isin_maturity
    ? String(gsec.isin_maturity).slice(0, 10)
    : null;
  if (!restoreMaturity) throw new Error('Cannot determine original GSEC maturity from isin_master');

  console.log('REPO', repo.deal_number, 'maturity', String(repo.maturity_date).slice(0, 10), '->', DATE);
  console.log('GSEC', gsec.deal_number, 'maturity', String(gsec.maturity_date).slice(0, 10), '-> restore', restoreMaturity);

  if (!EXECUTE) {
    console.log('\nDry run only. Re-run with --execute to apply.');
    process.exit(0);
  }

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE gsec SET maturity_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [restoreMaturity, GSEC_ID]
    );

    const [repoUpd] = await conn.query(
      `UPDATE repo_deals
          SET maturity_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND COALESCE(matured, 0) = 0
          AND approval_status = 'final_approved'`,
      [DATE, REPO_ID]
    );
    if (!repoUpd.affectedRows) {
      throw new Error('Repo update affected 0 rows');
    }

    await conn.query(
      `INSERT INTO maturity_processing_log
       (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
        processed_date, processed_by, authorization_level, notes)
       SELECT id, deal_number, 'premature_maturity', principal_amount, interest_amount, maturity_amount,
              ?, NULL, 'system', ?
         FROM repo_deals WHERE id = ?`,
      [
        DATE,
        `Premature maturity (corrective after id-collision bug): maturity_date updated to ${DATE}`,
        REPO_ID
      ]
    );

    await conn.query(
      `INSERT INTO maturity_processing_log
       (deal_id, deal_number, maturity_action, principal_amount, interest_amount, total_amount,
        processed_date, processed_by, authorization_level, notes)
       SELECT id, deal_number, 'premature_maturity', face_value, 0, face_value,
              ?, NULL, 'system', ?
         FROM gsec WHERE id = ?`,
      [
        DATE,
        `REVERT of mistaken premature maturity (id collision with repo ${REPO_ID}): maturity_date restored to ${restoreMaturity}`,
        GSEC_ID
      ]
    );

    await conn.commit();
    console.log('\nCommitted.');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const [r2] = await db.query('SELECT deal_number, maturity_date FROM repo_deals WHERE id=?', [REPO_ID]);
  const [g2] = await db.query('SELECT deal_number, maturity_date FROM gsec WHERE id=?', [GSEC_ID]);
  console.log('REPO now:', r2[0]);
  console.log('GSEC now:', g2[0]);
  process.exit(0);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
