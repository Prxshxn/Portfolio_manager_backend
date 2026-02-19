# Run this from: cd C:\Project\portfolio__manager
# Purpose: Find which files differ between MSPS and Live1 for 3-level auth

Write-Host "=== Files that differ between MSPS and Live1 (all) ===" -ForegroundColor Cyan
git diff MSPS..Live1 --name-only

Write-Host "`n=== Trying paths with Portfolio_manager_backend/ prefix ===" -ForegroundColor Cyan
$backendPaths = @(
  "Portfolio_manager_backend/controllers/maturityController.js",
  "Portfolio_manager_backend/controllers/transactionController.js",
  "Portfolio_manager_backend/models/gsec.js",
  "Portfolio_manager_backend/routes/fixedDepositRoutes.js",
  "Portfolio_manager_backend/routes/moneyMarketDeals.js",
  "Portfolio_manager_backend/controllers/isinMasterController.js",
  "Portfolio_manager_backend/models/transactionModel.js"
)
git diff MSPS..Live1 -- $backendPaths

Write-Host "`n=== If still empty: list repo root structure on Live1 ===" -ForegroundColor Cyan
git ls-tree -r Live1 --name-only | Select-String -Pattern "controller|maturity|gsec|fixedDeposit|transaction" | Select-Object -First 30
