'use strict';

const db = require('../config/database');

// Same order as login: a user with several assignments gets the highest workflow role.
const ROLE_PRIORITY = [
  'back_office_final',
  'back_office_verifier',
  'back_office',
  'front_office',
  'front_office_verifier',
  'authorizer'
];

function parsePages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'object') return Object.values(value).filter(Boolean).map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
      if (parsed) return [String(parsed)];
    } catch {
      return [value];
    }
  }
  return [];
}

/**
 * Workflow role and tabs from the database, not from JWT or x-user-data.
 * Returns null if the user id is missing or the user row does not exist.
 */
async function resolveEffectiveWorkflowAuth(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [users] = await db.query(
    'SELECT id, username, role, allowed_tabs FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  if (!users.length) return null;

  const user = users[0];
  const [assignments] = await db.query(
    'SELECT * FROM authorizer_assignments WHERE user_id = ?',
    [id]
  );

  let effectiveRole = user.role || 'user';
  let allowedTabs = parsePages(user.allowed_tabs);

  if (assignments && assignments.length > 0) {
    let best = assignments[0];
    for (const role of ROLE_PRIORITY) {
      const found = assignments.find((a) => a.role === role);
      if (found) {
        best = found;
        break;
      }
    }
    effectiveRole = best.role;
    allowedTabs = Array.from(new Set([...allowedTabs, ...parsePages(best.allowed_pages)]));
  }

  return {
    id: user.id,
    username: user.username,
    role: effectiveRole,
    originalRole: user.role,
    allowedTabs,
    isAdmin: user.role === 'admin' || effectiveRole === 'admin',
    assignments
  };
}

module.exports = {
  ROLE_PRIORITY,
  parsePages,
  resolveEffectiveWorkflowAuth
};
