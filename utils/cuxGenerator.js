const db = require('../config/db');

/**
 * Generate a unique CUX number for counterparties
 * Format: CUX followed by a 6-digit number (e.g., CUX000001, CUX000002)
 * 
 * @param {string} type - Counterparty type: 'individual', 'joint', or 'corporate'
 * @returns {Promise<string>} - Generated CUX number
 */
async function generateCuxNumber(type = 'individual') {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cuxGenerator.js:10',message:'generateCuxNumber entry',data:{type:type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  try {
    // Get the highest CUX number from all counterparty tables
    const queries = [
      `SELECT MAX(CAST(SUBSTRING(cux_number, 4) AS UNSIGNED)) as max_num 
       FROM counterparty_master_individual 
       WHERE cux_number IS NOT NULL AND cux_number REGEXP '^CUX[0-9]+$'`,
      `SELECT MAX(CAST(SUBSTRING(cux_number, 4) AS UNSIGNED)) as max_num 
       FROM counterparty_master_joint 
       WHERE cux_number IS NOT NULL AND cux_number REGEXP '^CUX[0-9]+$'`,
      `SELECT MAX(CAST(SUBSTRING(cux_number, 4) AS UNSIGNED)) as max_num 
       FROM counterparty_master_corporate 
       WHERE cux_number IS NOT NULL AND cux_number REGEXP '^CUX[0-9]+$'`
    ];

    const results = await Promise.all(queries.map((query, idx) => {
      return db.query(query).catch(err => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cuxGenerator.js:28',message:'query error in generateCuxNumber',data:{queryIndex:idx,error:err.message,code:err.code,errno:err.errno},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        // If table doesn't exist or column doesn't exist, return empty result
        console.warn('Query failed (table/column may not exist yet):', err.message);
        return [[{ max_num: null }]];
      });
    }));
    
    // Find the maximum number across all tables
    let maxNumber = 0;
    results.forEach(result => {
      const [rows] = result;
      if (rows && rows.length > 0 && rows[0] && rows[0].max_num !== null && rows[0].max_num !== undefined) {
        const num = parseInt(rows[0].max_num) || 0;
        if (num > maxNumber) {
          maxNumber = num;
        }
      }
    });

    // Generate next CUX number (increment by 1)
    // Start from 1 if no existing CUX numbers found
    const nextNumber = maxNumber + 1;
    
    // Format as CUX followed by 6-digit number (e.g., CUX000001)
    const cuxNumber = `CUX${String(nextNumber).padStart(6, '0')}`;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cuxGenerator.js:50',message:'generateCuxNumber success',data:{cuxNumber:cuxNumber,maxNumber:maxNumber,nextNumber:nextNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return cuxNumber;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cuxGenerator.js:54',message:'generateCuxNumber catch error',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error('Error generating CUX number:', error);
    // Fallback: use timestamp-based number if query fails
    const timestamp = Date.now() % 1000000; // Last 6 digits of timestamp
    const fallbackCux = `CUX${String(timestamp).padStart(6, '0')}`;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cuxGenerator.js:58',message:'generateCuxNumber fallback',data:{fallbackCux:fallbackCux},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return fallbackCux;
  }
}

module.exports = {
  generateCuxNumber
};

