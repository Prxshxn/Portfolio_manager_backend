# Chart of Accounts CSV Import Guide

## Overview

This guide explains how to import your new chart of accounts from a CSV file into the system. The system supports two formats:
1. **Simple Format** - Direct account codes
2. **New Hierarchical Format** - Primary/Sub codes with Categor Location mapping

## CSV File Formats

### Format 1: Simple Format (Legacy)

```csv
Account Code,Description,Active Status
1-001-01-01-01,Asset Motor Vehicles,Yes
1-002-01-01-01,Asset Office Computers,Yes
```

### Format 2: New Hierarchical Format (Recommended)

Your CSV file should have columns for Primary Code, Sub Code, Description, and Categor Location:

```csv
Primary Code,Sub Code,Description,Active Status,Categor Location Col1,Col2,Col3,Col4,Col5
110,25,Fixed assets - computer equipment,Yes,111,101,110,25,44
110,32,Fixed assets - office equipment,Yes,111,101,110,32,44
170,44,Financial Assets at amortised cost,Yes,111,101,170,44,44
350,92,Treasury Bonds - Held to Maturity,Yes,131,101,350,92,44
410,164,Seylan Bank A/C - 0860-13374197-001,Yes,131,101,410,164,44
```

### Required Columns (New Format):
- **Primary Code** - 3-digit primary account code (e.g., 110, 170, 230, 290, 350, 410)
- **Sub Code** - 2-3 digit sub-account code (e.g., 25, 32, 44, 50)
- **Description** - Account name/description
- **Active Status** - "Yes" or "No" (case insensitive)
- **Categor Location Columns** (4-5 columns) - Used to build full account code in format XXX-XXX-XXX-XXX-XX

### Account Code Structure (New Format):
The full account code is built from Categor Location columns:
- Format: `XXX-XXX-XXX-XXX-XX`
- Example: `111-101-110-025-44` (from columns [111, 101, 110, 25, 44])

## Import Methods

### Method 1: Command Line Script (Recommended)

**For New Hierarchical Format:**
```bash
cd Portfolio_manager_backend
node scripts/importChartOfAccountsNewFormat.js "path/to/your/chart-of-accounts.csv"
```

**For Simple Format (Legacy):**
```bash
cd Portfolio_manager_backend
node scripts/importChartOfAccounts.js "path/to/your/chart-of-accounts.csv"
```

**Options (Both Scripts):**
```bash
# Delete all existing accounts before import
node scripts/importChartOfAccountsNewFormat.js "path/to/file.csv" --delete-existing

# Don't update existing accounts (only insert new ones)
node scripts/importChartOfAccountsNewFormat.js "path/to/file.csv" --no-update

# Dry run (see what would be imported without actually importing)
node scripts/importChartOfAccountsNewFormat.js "path/to/file.csv" --dry-run

# Combine options
node scripts/importChartOfAccountsNewFormat.js "path/to/file.csv" --delete-existing --dry-run
```

**Example:**
```bash
# New format
node scripts/importChartOfAccountsNewFormat.js "C:\Project\new-chart-of-accounts.csv" --delete-existing

# Simple format
node scripts/importChartOfAccounts.js "C:\Project\simple-chart-of-accounts.csv" --delete-existing
```

### Method 2: API Endpoint (Web Interface)

**Upload CSV via API:**

```bash
POST http://localhost:3001/api/chart-of-accounts/import
Content-Type: multipart/form-data

file: <your-csv-file>
deleteExisting: true (optional)
updateExisting: true (optional, default: true)
```

**Using cURL:**
```bash
curl -X POST http://localhost:3001/api/chart-of-accounts/import \
  -F "file=@path/to/your/chart-of-accounts.csv" \
  -F "deleteExisting=true"
```

**Using Postman:**
1. Method: `POST`
2. URL: `http://localhost:3001/api/chart-of-accounts/import`
3. Body: `form-data`
4. Add key `file` (type: File) and select your CSV file
5. Optionally add `deleteExisting` (type: Text) = `true`
6. Optionally add `updateExisting` (type: Text) = `true`
7. Optionally add `useNewFormat` (type: Text) = `true` (for new hierarchical format)

### Method 3: Export Current Accounts

To export your current chart of accounts (for backup or reference):

```bash
GET http://localhost:3001/api/chart-of-accounts/export
```

Or in browser:
```
http://localhost:3001/api/chart-of-accounts/export
```

## Import Process

1. **Account Type Mapping**: The script automatically maps accounts to account types based on:
   - Account name patterns (e.g., "Cash", "Investment", "Interest Income")
   - Section headers (ASSET, LIABILITY, INCOME, EXPENSE)
   - Falls back to default account type if not found

2. **Category Inference**: 
   - ASSET, LIABILITY, EQUITY → `BS` (Balance Sheet)
   - INCOME, EXPENSE, REVENUE → `PL` (Profit & Loss)

3. **Duplicate Handling**:
   - If `updateExisting=true`: Updates existing accounts with same account_code
   - If `updateExisting=false`: Skips existing accounts

## Import Options

| Option | Description | Default |
|--------|-------------|---------|
| `--delete-existing` | Delete all existing accounts before import | `false` |
| `--no-update` | Skip updating existing accounts (only insert new) | `false` (updates by default) |
| `--dry-run` | Show what would be imported without actually importing | `false` |

## Example CSV File

```csv
Account Code,Description,Active Status
1-001-01-01-01,Asset Motor Vehicles,Yes
1-002-01-01-01,Asset Office Computers,Yes
1-034-01-01-01,Asset Treasury Bonds,Yes
1-201-01-01-01,Asset Lending Interest Receivable,Yes
1-212-01-01-01,Asset GSEC Accrual,Yes
1-315-01-01-01,Asset Lending Control,Yes
1-666-01-01-01,Asset Seylan Bank Settlement,Yes
2-304-01-01-01,Liability Borrowing Interest,Yes
2-708-01-01-01,Liability Loan Payable,Yes
3-004-01-01-01,Income GSEC Accrual,Yes
4-015-01-01-01,Income Lending Interest,Yes
6-288-01-01-01,Expense Borrowing Interest,Yes
```

## Troubleshooting

### Error: "Account type not found"

**Solution**: The script will use a fallback account type. To fix:
1. Check that `account_types` table has appropriate types
2. The script will automatically infer types, but you can manually update after import

### Error: "Duplicate entry"

**Solution**: 
- Use `--delete-existing` to replace all accounts
- Or use `updateExisting=true` (default) to update existing accounts

### Error: "File not found"

**Solution**: 
- Use absolute path: `C:\Project\chart-of-accounts.csv`
- Or relative path from script location

### Imported accounts don't match expected account types

**Solution**:
1. After import, review accounts in database
2. Manually update `account_type_id` if needed:
   ```sql
   UPDATE chart_of_accounts 
   SET account_type_id = <correct_id> 
   WHERE account_code = '<account_code>';
   ```

## Post-Import Steps

After importing your new chart of accounts:

1. **Verify Import**:
   ```sql
   SELECT COUNT(*) FROM chart_of_accounts;
   SELECT * FROM chart_of_accounts LIMIT 10;
   ```

2. **Update Account Mappings**:
   Use the Account Mapping API to map your new account codes:
   ```bash
   POST http://localhost:3001/api/account-mappings/bulk
   {
     "mappings": [
       {
         "mappingKey": "GSEC_ASSET_TBONDS",
         "accountCode": "YOUR_NEW_CODE",
         "description": "GSEC Asset"
       }
       // ... other mappings
     ]
   }
   ```

3. **Test Transactions**:
   - Create a test GSEC transaction
   - Create a test Money Market deal
   - Verify ledger entries use correct account codes

## Best Practices

1. **Backup First**: Export current chart of accounts before importing new one
2. **Dry Run**: Always do a `--dry-run` first to see what will be imported
3. **Test Import**: Import to a test database first if possible
4. **Verify Mapping**: After import, verify account types are correct
5. **Update Mappings**: Update account mappings after importing new chart

## Support

If you encounter issues:
1. Check the console output for specific error messages
2. Verify CSV format matches expected format
3. Check that account_types table has required types
4. Review the import summary for skipped/error accounts
