const pool = require('../config/database');

async function getForceLogoutState() {
  const [rows] = await pool.query(
    'SELECT force_logout_at, force_logout_exempt_user_id FROM auth_settings WHERE id = 1'
  );
  return rows[0] || { force_logout_at: null, force_logout_exempt_user_id: null };
}

/** Invalidate every token issued before now, except the triggering user's. */
async function forceLogoutAllExcept(exemptUserId) {
  await pool.query(
    `INSERT INTO auth_settings (id, force_logout_at, force_logout_exempt_user_id)
     VALUES (1, NOW(), ?)
     ON DUPLICATE KEY UPDATE force_logout_at = NOW(), force_logout_exempt_user_id = VALUES(force_logout_exempt_user_id)`,
    [exemptUserId ?? null]
  );
}

module.exports = { getForceLogoutState, forceLogoutAllExcept };
