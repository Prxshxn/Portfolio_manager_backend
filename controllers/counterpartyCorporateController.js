const CounterpartyCorporate = require('../models/counterpartyCorporateModel');

exports.createCounterpartyCorporate = async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateController.js:3',message:'createCounterpartyCorporate entry',data:{bodyKeys:Object.keys(req.body),bodyValues:req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D'})}).catch(()=>{});
  // #endregion
  try {
    const result = await CounterpartyCorporate.create(req.body);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateController.js:6',message:'createCounterpartyCorporate success',data:{insertId:result.insertId,cuxNumber:result.cux_number},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D'})}).catch(()=>{});
    // #endregion
    res.status(201).json({ 
      id: result.insertId, 
      cux_number: result.cux_number,
      ...req.body 
    });
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/29dc6e6a-2fb8-4497-a57e-c480a1e8f80b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'counterpartyCorporateController.js:13',message:'createCounterpartyCorporate error',data:{error:err.message,stack:err.stack,code:err.code,errno:err.errno,sqlState:err.sqlState,sqlMessage:err.sqlMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A,B,C,D'})}).catch(()=>{});
    // #endregion
    res.status(500).json({ error: err.message || err });
  }
};

exports.getAllCounterpartyCorporates = async (req, res) => {
  try {
    const results = await CounterpartyCorporate.getAll();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.getCounterpartyCorporateById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyCorporate.getById(id);
    if (!result) {
      return res.status(404).json({ error: 'Counterparty not found' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};

exports.updateCounterpartyCorporate = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await CounterpartyCorporate.update(id, req.body);
    res.json({ success: true, message: 'Counterparty updated successfully', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
};
