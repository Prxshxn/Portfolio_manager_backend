/**
 * Smoke test: GET /api/accounting/settlement-preview?year=2026&months=4,5
 */
const http = require('http');
require('dotenv').config();

const PORT = process.env.PORT || 5000;

const options = {
  hostname: 'localhost',
  port: PORT,
  path: '/api/accounting/settlement-preview?year=2026&months=4,5',
  method: 'GET',
  headers: { 'x-user-data': JSON.stringify({ id: 1, role: 'admin', username: 'test' }) },
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (data.error) { console.error('API error:', data.error); process.exit(1); }
      console.log(`Year: ${data.year}`);
      for (const m of (data.months || [])) {
        console.log(`\n=== ${m.label} ===`);
        console.log(`  Posted   : Dr ${m.totals.debit?.toFixed(2).padStart(18)}  Cr ${m.totals.credit?.toFixed(2).padStart(18)}  (${m.totals.count} lines)`);
        console.log(`  Estimated: Dr ${(m.totals.estimatedDebit||0).toFixed(2).padStart(18)}  Cr ${(m.totals.estimatedCredit||0).toFixed(2).padStart(18)}  (${m.totals.unposted||0} unposted deals)`);
        for (const [key, g] of Object.entries(m.groups || {})) {
          if (g.entries.length > 0) {
            const postedLines   = g.entries.filter(e => e.posted).length;
            const unpostedLines = g.entries.filter(e => !e.posted).length;
            const estStr = (g.totals.estimatedDebit > 0)
              ? `  est.Dr=${g.totals.estimatedDebit.toFixed(2)}`
              : '';
            console.log(`  [${key.padEnd(13)}] posted-lines=${String(postedLines).padStart(4)} est-lines=${String(unpostedLines).padStart(3)} deals=${String(g.totals.unposted||0).padStart(3)}  posted Dr=${g.totals.debit.toFixed(2)}${estStr}`);
          }
        }

        // Print first unposted Buyback Buy with its expanded lines, so we can
        // visually confirm the 3-line structure.
        const bb = (m.groups?.buyback_buy?.entries || []).filter(e => !e.posted);
        if (bb.length > 0) {
          console.log('  -- sample unposted Buyback Buy lines --');
          const dealNo = bb[0].deal_number;
          for (const e of bb.filter(x => x.deal_number === dealNo)) {
            console.log(`    ${e.account_code}  ${(e.estimated_debit || 0).toFixed(2).padStart(16)}  ${(e.estimated_credit || 0).toFixed(2).padStart(16)}  ${e.ledger_description}`);
          }
        }
      }
    } catch (e) {
      console.error('Parse error:', e.message, '\nBody:', body.slice(0, 500));
    }
  });
});
req.on('error', (e) => console.error('Request error:', e.message));
req.end();
