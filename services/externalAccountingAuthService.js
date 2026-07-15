/**
 * Manages the service-account token for the external accounting API
 * (Trial Balance / GSec Balance Sheet). This app's own user tokens are NOT
 * valid there - it's a separate service with its own auth, so this backend
 * logs in once with a dedicated service account and caches the token,
 * re-authenticating when it's missing, expired, or rejected.
 */
const EXTERNAL_ACCOUNTING_API_BASE_URL =
  process.env.EXTERNAL_ACCOUNTING_API_BASE_URL ||
  'https://vc1bp9jg70.execute-api.us-east-1.amazonaws.com/prod';

let cachedToken = null;
let cachedTokenExpiryMs = null;
let loginPromise = null;

function decodeJwtExpiryMs(token) {
  try {
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch (_) {
    return null;
  }
}

async function login() {
  const email = process.env.EXTERNAL_ACCOUNTING_API_EMAIL;
  const password = process.env.EXTERNAL_ACCOUNTING_API_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'EXTERNAL_ACCOUNTING_API_EMAIL / EXTERNAL_ACCOUNTING_API_PASSWORD are not configured'
    );
  }

  const res = await fetch(`${EXTERNAL_ACCOUNTING_API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`External accounting login failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.token) {
    throw new Error('External accounting login response did not include a token');
  }

  cachedToken = data.token;
  cachedTokenExpiryMs = decodeJwtExpiryMs(data.token);
  return cachedToken;
}

/**
 * @param {boolean} [forceRefresh] - bypass the cache and log in again (e.g. after a 401).
 * @returns {Promise<string>} bearer token
 */
async function getServiceToken(forceRefresh = false) {
  const now = Date.now();
  const expiringSoon = cachedTokenExpiryMs && cachedTokenExpiryMs - now < 30000;

  if (forceRefresh || !cachedToken || expiringSoon) {
    // Coalesce concurrent callers into a single login request.
    if (!loginPromise) {
      loginPromise = login().finally(() => {
        loginPromise = null;
      });
    }
    return loginPromise;
  }

  return cachedToken;
}

module.exports = { getServiceToken, EXTERNAL_ACCOUNTING_API_BASE_URL };
