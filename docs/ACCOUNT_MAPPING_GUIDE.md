# Account Mapping System Guide

## Overview

The Account Mapping System allows you to replace hardcoded account codes throughout the system with a centralized configuration. This makes it easy to update account codes when your chart of accounts changes without modifying code.

## Architecture

### Components

1. **Account Mapping Service** (`services/accountMappingService.js`)
   - Centralized service for retrieving account codes
   - Supports both direct mappings and pattern-based lookups
   - Provides fallback to default account codes

2. **Account Mappings Table** (`account_mappings`)
   - Stores mapping keys to account codes
   - Links to `chart_of_accounts` table
   - Supports active/inactive mappings

3. **API Routes** (`routes/accountMappingRoutes.js`)
   - RESTful API for managing account mappings
   - Supports single and bulk updates

## Available Mapping Keys

| Mapping Key | Description | Default Account Code |
|------------|-------------|---------------------|
| `GSEC_ASSET_TBONDS` | GSEC Asset - Treasury Bonds | `1-034-01-01-01` |
| `GSEC_DEFAULT_SETTLEMENT` | GSEC Default Settlement Account | `1-666-01-01-01` |
| `GSEC_ACCRUAL_ASSET` | GSEC Daily Accrual Asset | `1-212-01-01-01` |
| `GSEC_ACCRUAL_INCOME` | GSEC Daily Accrual Income | `3-004-01-01-01` |
| `MM_LENDING_CONTROL` | Money Market Lending Control | `1-315-01-01-01` |
| `MM_LOAN_LIABILITY` | Money Market Loan Liability | `2-708-01-01-01` |
| `MM_LENDING_INTEREST_ASSET` | MM Lending Interest Asset | `1-201-01-01-01` |
| `MM_LENDING_INTEREST_INCOME` | MM Lending Interest Income | `4-015-01-01-01` |
| `MM_BORROWING_INTEREST_EXPENSE` | MM Borrowing Interest Expense | `6-288-01-01-01` |
| `MM_BORROWING_INTEREST_LIABILITY` | MM Borrowing Interest Liability | `2-304-01-01-01` |

## Setup Instructions

### Step 1: Run the Migration

Create the `account_mappings` table:

```bash
node Portfolio_manager_backend/migrations/20250120-create-account-mappings-table.js
```

Or run it programmatically:

```javascript
const createAccountMappingsTable = require('./migrations/20250120-create-account-mappings-table');
await createAccountMappingsTable();
```

### Step 2: Update Your Chart of Accounts

1. Import your new chart of accounts into the `chart_of_accounts` table
2. Ensure all account codes from your new chart are present

### Step 3: Map Account Codes

Use the API to map your new account codes:

#### Single Mapping

```bash
POST http://localhost:3001/api/account-mappings
Content-Type: application/json

{
  "mappingKey": "GSEC_ASSET_TBONDS",
  "accountCode": "YOUR_NEW_ACCOUNT_CODE",
  "description": "GSEC Asset - Treasury Bonds"
}
```

#### Bulk Mapping

```bash
POST http://localhost:3001/api/account-mappings/bulk
Content-Type: application/json

{
  "mappings": [
    {
      "mappingKey": "GSEC_ASSET_TBONDS",
      "accountCode": "NEW-CODE-001",
      "description": "GSEC Asset"
    },
    {
      "mappingKey": "MM_LENDING_CONTROL",
      "accountCode": "NEW-CODE-002",
      "description": "MM Lending Control"
    }
  ]
}
```

## API Endpoints

### Get All Mappings
```
GET /api/account-mappings
```

### Get Specific Mapping
```
GET /api/account-mappings/{mappingKey}
```

### Create/Update Mapping
```
POST /api/account-mappings
Body: { mappingKey, accountCode, description }
```

### Bulk Update Mappings
```
POST /api/account-mappings/bulk
Body: { mappings: [{ mappingKey, accountCode, description }, ...] }
```

### Get All Available Mapping Keys
```
GET /api/account-mappings/keys/all
```

## Usage in Code

### Basic Usage

```javascript
const accountMapping = require('../services/accountMappingService');

// Get account code
const accountCode = await accountMapping.getAccountCode(
  accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS
);

// Get account ID
const accountId = await accountMapping.getAccountId(
  accountMapping.MAPPING_KEYS.MM_LENDING_CONTROL
);
```

### In Ledger Entry Creation

```javascript
const accountMapping = require('../services/accountMappingService');
const ledgerController = require('../controllers/ledgerController');

const drAccount = await accountMapping.getAccountCode(
  accountMapping.MAPPING_KEYS.GSEC_ASSET_TBONDS
);
const crAccount = await accountMapping.getAccountCode(
  accountMapping.MAPPING_KEYS.GSEC_DEFAULT_SETTLEMENT
);

await ledgerController.postLedgerEntry({
  date: '2025-01-20',
  dr_account: drAccount,
  cr_account: crAccount,
  amount: 1000000,
  deal_id: 'DEAL123',
  description: 'GSec Purchase'
});
```

## Migration from Old Account Codes

### Process

1. **Backup Current Data**: Ensure you have backups of your `chart_of_accounts` and `ledger_entries` tables

2. **Import New Chart of Accounts**: 
   - Clear or update the `chart_of_accounts` table with your new structure
   - Ensure all required accounts exist

3. **Map Old Codes to New Codes**:
   - Identify which new account codes correspond to each mapping key
   - Use the bulk update API to set all mappings at once

4. **Verify Mappings**:
   ```bash
   GET /api/account-mappings
   ```

5. **Test Transactions**:
   - Create a test GSEC transaction
   - Create a test Money Market deal
   - Verify ledger entries use the correct new account codes

6. **Monitor**: Check logs for any "Using default account code" warnings

## Troubleshooting

### Account Code Not Found

**Error**: `Account code not found: XXX`

**Solution**: 
1. Verify the account code exists in `chart_of_accounts`
2. Check the account code is active (`is_active = TRUE`)
3. Verify the mapping is set correctly

### Using Default Account Codes

**Warning**: `Using default account code for GSEC_ASSET_TBONDS: 1-034-01-01-01`

**Solution**: 
- This means the mapping is not set in the database
- Set the mapping using the API or directly in the database
- The system will continue to work with defaults, but you should update them

### Mapping Not Working

**Issue**: Transactions still using old account codes

**Solution**:
1. Verify the migration ran successfully
2. Check that mappings are set in `account_mappings` table
3. Clear any caches if applicable
4. Restart the server

## Database Schema

### account_mappings Table

```sql
CREATE TABLE account_mappings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mapping_key VARCHAR(100) NOT NULL UNIQUE,
  account_code VARCHAR(20) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_code) REFERENCES chart_of_accounts(account_code)
);
```

## Best Practices

1. **Set All Mappings**: Don't rely on defaults - explicitly set all mappings for your new chart of accounts

2. **Use Descriptions**: Always include descriptions when creating mappings for documentation

3. **Test Before Production**: Test all transaction types with new mappings before going live

4. **Version Control**: Keep a record of your mapping configuration (export via API)

5. **Monitor Logs**: Watch for warnings about default account codes being used

## Example: Complete Migration Script

```javascript
const accountMapping = require('./services/accountMappingService');

async function migrateAccountMappings() {
  const newMappings = {
    'GSEC_ASSET_TBONDS': 'NEW-001-01-01-01',
    'GSEC_DEFAULT_SETTLEMENT': 'NEW-002-01-01-01',
    'GSEC_ACCRUAL_ASSET': 'NEW-003-01-01-01',
    'GSEC_ACCRUAL_INCOME': 'NEW-004-01-01-01',
    'MM_LENDING_CONTROL': 'NEW-005-01-01-01',
    'MM_LOAN_LIABILITY': 'NEW-006-01-01-01',
    'MM_LENDING_INTEREST_ASSET': 'NEW-007-01-01-01',
    'MM_LENDING_INTEREST_INCOME': 'NEW-008-01-01-01',
    'MM_BORROWING_INTEREST_EXPENSE': 'NEW-009-01-01-01',
    'MM_BORROWING_INTEREST_LIABILITY': 'NEW-010-01-01-01'
  };

  for (const [key, code] of Object.entries(newMappings)) {
    try {
      await accountMapping.setAccountMapping(key, code, `Migrated: ${key}`);
      console.log(`✓ Mapped ${key} -> ${code}`);
    } catch (error) {
      console.error(`✗ Failed to map ${key}:`, error.message);
    }
  }
  
  console.log('Migration complete!');
}

migrateAccountMappings();
```

## Support

For issues or questions:
1. Check the logs for error messages
2. Verify account codes exist in `chart_of_accounts`
3. Test individual mappings using the API
4. Review this documentation
