const db = require('../config/database');
const CashflowCaptureService = require('../services/cashflowCaptureService');

async function main() {
  try {
    console.log('Running auto cashflow capture...');
    const captured = await CashflowCaptureService.autoCaptureExistingTransactions();

    const [ctCountRows] = await db.query('SELECT COUNT(*) AS count FROM cashflow_transactions');
    const [finalMatRows] = await db.query("SELECT COUNT(*) AS count FROM maturity_processing_log WHERE authorization_level='back_office_final'");

    const summary = {
      captured,
      cashflowTransactionCount: ctCountRows[0]?.count || 0,
      finalApprovedMaturities: finalMatRows[0]?.count || 0
    };
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Auto cashflow capture failed:', err);
    process.exit(1);
  }
}

main();


