/**
 * Runs the EOD route in a standalone process, isolated from the nodemon dev
 * server so a file-watch restart cannot kill the run half-way.
 *
 * The route is mounted on a throwaway Express app on an ephemeral port and
 * invoked once. All of the route's own console output is streamed here, so a
 * failure is captured with full context instead of surfacing as a bare
 * "EOD failed" in the browser.
 *
 * Usage: node scripts/run-eod-inprocess.js
 */
require('dotenv').config();
const express = require('express');
const db = require('../config/database');

(async () => {
  // Exempt a real admin from the post-EOD force-logout the route triggers.
  let adminId = null;
  try {
    const [admins] = await db.query(
      `SELECT id, role FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`
    );
    if (admins && admins.length) {
      adminId = admins[0].id;
      console.log(`Running EOD as admin id=${adminId}`);
    }
  } catch (err) {
    console.warn('Could not resolve an admin user, continuing:', err.message);
  }

  const readSystemDate = async () => {
    const [rows] = await db.query('SELECT system_date FROM system_day ORDER BY id DESC LIMIT 1');
    return rows[0] && rows[0].system_date;
  };

  const before = await readSystemDate();
  console.log(`System date before run: ${new Date(before).toISOString().slice(0, 10)}\n`);

  const app = express();
  app.use(express.json());
  app.use('/', require('../routes/moneyMarketEodRoutes'));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const started = Date.now();
  console.log('=== EOD run starting ===');

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/eod`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // checkAuth / checkAdmin accept an x-user-data identity when no JWT is present.
        'x-user-data': JSON.stringify({ id: adminId, role: 'admin' })
      },
      body: '{}'
    });
  } catch (err) {
    console.error('\nEOD request itself failed:', err);
    server.close();
    process.exit(1);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const text = await res.text();
  console.log(`\n=== EOD run finished in ${elapsed}s with HTTP ${res.status} ===`);

  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    console.log('Non-JSON response body:', text.slice(0, 2000));
  }

  if (body) {
    console.log(JSON.stringify(body, null, 2));
  }

  const after = await readSystemDate();
  console.log(`\nSystem date after run: ${new Date(after).toISOString().slice(0, 10)}`);

  server.close();
  process.exit(res.ok ? 0 : 1);
})().catch((err) => {
  console.error('Runner crashed:', err);
  process.exit(1);
});
