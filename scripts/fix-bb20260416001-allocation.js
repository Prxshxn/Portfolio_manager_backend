/**
 * Option A fix: correct the single fractional allocation in buyback
 * BB20260416001 so its amountToSell matches the deal's leg1_face_value.
 *
 *   5,104,045.98  ->  5,104,046.00
 *
 * Idempotent: only updates if the allocation is still the known bad value.
 */
const db = require('../config/db');

const TARGET_DEAL = 'BB20260416001';
const BAD_AMOUNT = 5104045.98;
const GOOD_AMOUNT = 5104046.00;

(async () => {
  try {
    const [rows] = await db.query(
      `SELECT id, deal_number, leg1_face_value, sell_deal_allocations
         FROM buyback_deals
        WHERE deal_number = ?`,
      [TARGET_DEAL]
    );

    if (!rows || rows.length === 0) {
      console.log(`Deal ${TARGET_DEAL} not found. Nothing to do.`);
      return;
    }

    const row = rows[0];
    const allocs = typeof row.sell_deal_allocations === 'string'
      ? JSON.parse(row.sell_deal_allocations)
      : row.sell_deal_allocations;

    if (!Array.isArray(allocs)) {
      console.log(`Deal ${TARGET_DEAL}: sell_deal_allocations is not an array; nothing to fix.`);
      return;
    }

    console.log(`BEFORE leg1_face_value=${row.leg1_face_value}`);
    console.log('BEFORE allocations:', JSON.stringify(allocs));

    let changed = false;
    const fixed = allocs.map(a => {
      const amt = Number(a.amountToSell);
      if (Math.abs(amt - BAD_AMOUNT) < 1e-6) {
        changed = true;
        return { ...a, amountToSell: GOOD_AMOUNT };
      }
      return a;
    });

    if (!changed) {
      console.log(`No allocation equals ${BAD_AMOUNT}; already fixed or different data. No update performed.`);
      return;
    }

    await db.query(
      `UPDATE buyback_deals SET sell_deal_allocations = ? WHERE id = ?`,
      [JSON.stringify(fixed), row.id]
    );

    const [after] = await db.query(
      `SELECT sell_deal_allocations FROM buyback_deals WHERE id = ?`,
      [row.id]
    );
    const afterAllocs = typeof after[0].sell_deal_allocations === 'string'
      ? JSON.parse(after[0].sell_deal_allocations)
      : after[0].sell_deal_allocations;

    console.log('AFTER  allocations:', JSON.stringify(afterAllocs));
    console.log('Update complete.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
