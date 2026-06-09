/* eslint-disable no-console */
const db = require('../config/database');

const DEAL = '20260522/GSEC/0004';

(async () => {
  const [entries] = await db.query(
    `SELECT DISTINCT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at 
     FROM ledger_entries 
     WHERE deal_number = ? 
     ORDER BY created_at`,
    [DEAL]
  );
  
  console.log('Ledger entries created at', entries.length, 'distinct timestamps:');
  entries.forEach(e => console.log(' -', e.created_at));
  
  const [gsecRecords] = await db.query(
    `SELECT id, face_value, buy_deal_number, 
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at 
     FROM gsec 
     WHERE deal_number = ? 
     ORDER BY id`,
    [DEAL]
  );
  
  console.log('\nTotal gsec sell records:', gsecRecords.length);
  console.log('Sum of all face values:', gsecRecords.reduce((s, r) => s + Number(r.face_value), 0).toFixed(2));
  
  await db.pool.end();
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
