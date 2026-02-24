/**
 * Add remaining_face_value to gsec if missing.
 * Safe to run multiple times.
 */
const db = require('../config/db');

async function addRemainingFaceValueToGsec() {
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gsec'
        AND COLUMN_NAME = 'remaining_face_value'
    `);
    if (cols.length > 0) {
      console.log('⏭ gsec.remaining_face_value already exists');
      return;
    }
    await db.query(`
      ALTER TABLE gsec
      ADD COLUMN remaining_face_value DECIMAL(20,4) NULL
    `);
    console.log('✓ gsec.remaining_face_value added');
  } catch (err) {
    console.error('Migration add-remaining-face-value-to-gsec failed:', err.message);
    throw err;
  }
}

if (require.main === module) {
  addRemainingFaceValueToGsec()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = addRemainingFaceValueToGsec;
