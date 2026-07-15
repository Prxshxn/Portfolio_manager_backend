/**
 * Server-to-server proxy for the external Trial Balance / GSec Balance Sheet API.
 *
 * The external API's CORS policy only allows requests from its own AWS Amplify
 * origin, so the browser blocks direct calls from this app's frontend. Proxying
 * through this backend avoids CORS entirely (server-to-server has no CORS
 * concept). It also authenticates with a dedicated service account (see
 * services/externalAccountingAuthService.js) rather than this app's own user
 * tokens, since the external API is a separate auth domain.
 */
const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const { getServiceToken, EXTERNAL_ACCOUNTING_API_BASE_URL } = require('../services/externalAccountingAuthService');

async function fetchExternal(externalPath, query) {
  const url = new URL(`${EXTERNAL_ACCOUNTING_API_BASE_URL}${externalPath}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  let token = await getServiceToken();
  let upstream = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });

  // Cached token might have been rejected (expired/revoked server-side) - refresh once and retry.
  if (upstream.status === 401) {
    token = await getServiceToken(true);
    upstream = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
  }

  return upstream;
}

async function proxyGet(externalPath, req, res) {
  try {
    const upstream = await fetchExternal(externalPath, req.query);
    const contentType = upstream.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await upstream.json()
      : await upstream.text();

    res.status(upstream.status);
    if (contentType.includes('application/json')) {
      return res.json(body);
    }
    return res.send(body);
  } catch (error) {
    console.error(`External accounting proxy error (${externalPath}):`, error.message);
    return res.status(502).json({
      success: false,
      message: 'Failed to reach the external accounting service. Please try again later.'
    });
  }
}

// GET /api/external-accounting/trial-balance?startDate=&endDate=&_ts=
router.get('/trial-balance', checkAuth, (req, res) => proxyGet('/trial-balance', req, res));

// GET /api/external-accounting/trial-balance/account/:accountCode?startDate=&endDate=
router.get('/trial-balance/account/:accountCode', checkAuth, (req, res) =>
  proxyGet(`/trial-balance/account/${encodeURIComponent(req.params.accountCode)}`, req, res)
);

// GET /api/external-accounting/gsec-entries/balance-sheet?startDate=&endDate=
router.get('/gsec-entries/balance-sheet', checkAuth, (req, res) =>
  proxyGet('/gsec-entries/balance-sheet', req, res)
);

// GET /api/external-accounting/gsec-entries/balance-sheet/account/:accountCode?startDate=&endDate=
router.get('/gsec-entries/balance-sheet/account/:accountCode', checkAuth, (req, res) =>
  proxyGet(`/gsec-entries/balance-sheet/account/${encodeURIComponent(req.params.accountCode)}`, req, res)
);

module.exports = router;
