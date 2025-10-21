const express = require('express');
const router = express.Router();
const portfolioMasterRoutes = require('./portfolioMasterRoutes');
const paymentMasterRoutes = require('./paymentMasterRoutes');
const authorizerRoutes = require('./authorizerRoutes');
const settlementAccountRoutes = require('./settlementAccountRoutes');
const systemDayRoutes = require('./systemDayRoutes');
const moneyMarketEodRoutes = require('./moneyMarketEodRoutes');
const accountingRoutes = require('./accounting');
const transactionsRoutes = require('./transactions');
const strategyMasterRoutes = require('./strategyMasterRoutes');
const reportMoneyMarketRoutes = require('./reportMoneyMarket');
const reportMarkToMarketRoutes = require('./reportMarkToMarket');
const reportBuybackRoutes = require('./reportBuyback');
const reportSellTransactionRoutes = require('./reportSellTransaction');
const markToMarketRoutes = require('./markToMarketRoutes');
const cashflowRoutes = require('./cashflowRoutes');

// Portfolio Master API
router.use('/portfolio-master', portfolioMasterRoutes);
router.use('/payment-master', paymentMasterRoutes);
router.use('/authorizers', authorizerRoutes);
router.use('/settlement-accounts', settlementAccountRoutes);
router.use('/system-day', systemDayRoutes);
router.use('/money-market', moneyMarketEodRoutes);
router.use('/accounting', accountingRoutes);
router.use('/transactions', transactionsRoutes);
router.use('/strategy-master', strategyMasterRoutes);
router.use('/mark-to-market', markToMarketRoutes);

// Additional routes for full API coverage
router.use('/accounts', require('./accounts'));
router.use('/auth', require('./authRoutes'));
router.use('/brokers', require('./brokerRoutes'));
router.use('/buyback', require('./buybackRoutes'));
router.use('/counterparties', require('./counterparties'));
router.use('/counterparty-individual', require('./counterpartyIndividualRoutes'));
router.use('/counterparty-joint', require('./counterpartyJointRoutes'));
router.use('/counterparty-corporate', require('./counterpartyCorporateRoutes'));
router.use('/isin-master', require('./isinMasterRoutes'));
router.use('/limit-setup', require('./limitSetupRoutes'));
router.use('/limit-status', require('./limitStatusRoutes'));
router.use('/money-market-deals', require('./moneyMarketDeals'));
router.use('/repo-deals', require('./repoRoutes'));
router.use('/securities', require('./securities'));
router.use('/user', require('./userRoutes'));
router.use('/cashflow', cashflowRoutes);
// Mount voucher router under /money-market for correct nested voucher download route
router.use('/money-market', require('./voucher'));
router.use('/transaction-types', require('./transactionTypes'));
// Note: transactionRoutes.js is skipped as transactions.js is already mounted.

// Mount Money Market report API
router.use('/reports/money-market', reportMoneyMarketRoutes);

// Mount Mark to Market report API
router.use('/reports/mark-to-market', reportMarkToMarketRoutes);

// Mount Buyback report API
router.use('/reports/buyback', reportBuybackRoutes);

// Mount Sell Transaction report API
router.use('/reports/sell-transaction', reportSellTransactionRoutes);

// Mount GSec workflow API
router.use('/gsec', require('./gsecRoutes'));

module.exports = router;
