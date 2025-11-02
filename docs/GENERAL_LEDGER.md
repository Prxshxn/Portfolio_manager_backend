# General Ledger System Documentation

## Overview

The General Ledger system implements double-entry accounting principles to automatically track all financial transactions in the portfolio management system. It provides comprehensive accounting functionality including automatic ledger entry creation, manual entry posting, and generation of financial reports.

## Architecture

### Database Schema

The system uses three core tables:

#### 1. `account_types`
Stores account type categories:
- **Categories**: `asset`, `liability`, `equity`, `revenue`, `expense`
- **Fields**: `id`, `name`, `category`, `description`, `created_at`

#### 2. `chart_of_accounts`
Hierarchical chart of accounts structure:
- **Fields**: 
  - `id` - Primary key
  - `account_code` - Unique account identifier (e.g., "1001", "8001")
  - `name` - Account name
  - `account_type_id` - Foreign key to `account_types`
  - `parent_account_id` - Self-referencing for hierarchical accounts
  - `description` - Account description
  - `is_active` - Boolean flag for active/inactive accounts
  - `created_at`, `updated_at` - Timestamps

#### 3. `ledger_entries`
Double-entry accounting records:
- **Fields**:
  - `id` - Primary key
  - `transaction_id` - Optional link to transactions table
  - `deal_number` - Optional deal number reference
  - `account_id` - Foreign key to `chart_of_accounts`
  - `entry_date` - Date of the entry
  - `debit_amount` - Debit amount (DECIMAL 15,2)
  - `credit_amount` - Credit amount (DECIMAL 15,2)
  - `currency` - Currency code (default: 'LKR')
  - `description` - Entry description
  - `created_at`, `updated_at` - Timestamps

**Key Constraints:**
- Each entry must have either a debit OR credit amount (not both)
- Double-entry: Total debits must equal total credits for any transaction
- All entries are linked to accounts via `account_id`

## Features

### 1. Automatic Ledger Entry Creation

The system automatically creates ledger entries when transactions are processed:

#### Transaction-Based Entries (`Accounting.createLedgerEntriesForTransaction`)

Automatically creates double-entry records based on transaction type:

**For Positive Amounts (Income/Deposit):**
- **Debit**: Asset account (Cash/Bank - account code starting with '1')
- **Credit**: Revenue account (account code starting with '8')

**For Negative Amounts (Expense/Withdrawal):**
- **Debit**: Expense account (account code starting with '9')
- **Credit**: Asset account (Cash/Bank - account code starting with '1')

#### Deal-Specific Entries (`ledgerController.postLedgerEntry`)

Used for EOD (End of Day) processing and maturity handling:
- Creates debit and credit entries based on account codes
- Supports deal number linking
- Used in maturity processing for principal and interest postings

**Example Usage:**
```javascript
const ledgerController = require('./controllers/ledgerController');

await ledgerController.postLedgerEntry({
  date: '2025-01-15',
  dr_account: '1001',      // Debit account code
  cr_account: '8001',      // Credit account code
  amount: 1000000.00,
  deal_id: 'DEAL123',
  description: 'Interest income payment'
});
```

### 2. Manual Ledger Entry Creation

#### API Endpoint: `POST /api/accounting/ledger-entries`

Allows manual creation of ledger entries with validation:

**Request Body:**
```json
{
  "entries": [
    {
      "deal_number": "DEAL123",
      "account_id": 1,
      "entry_date": "2025-01-15",
      "debit_amount": 1000000.00,
      "credit_amount": 0,
      "currency": "LKR",
      "description": "Manual adjustment entry"
    },
    {
      "deal_number": "DEAL123",
      "account_id": 2,
      "entry_date": "2025-01-15",
      "debit_amount": 0,
      "credit_amount": 1000000.00,
      "currency": "LKR",
      "description": "Matching credit entry"
    }
  ]
}
```

**Validation:**
- At least one entry required
- Total debits must equal total credits (within 0.01 tolerance for rounding)
- All required fields must be present

**Response:**
```json
{
  "message": "Ledger entries created successfully"
}
```

### 3. General Ledger Query

#### API Endpoint: `GET /api/accounting/general-ledger`

Retrieves ledger entries with filtering and pagination:

**Query Parameters:**
- `startDate` (optional) - Start date filter (YYYY-MM-DD)
- `endDate` (optional) - End date filter (YYYY-MM-DD)
- `accountId` (optional) - Filter by specific account
- `transactionId` (optional) - Filter by deal number
- `limit` (default: 100) - Number of records per page
- `offset` (default: 0) - Pagination offset

**Response:**
```json
{
  "total": 500,
  "limit": 100,
  "offset": 0,
  "entries": [
    {
      "id": 1,
      "deal_number": "DEAL123",
      "account_id": 1,
      "account_code": "1001",
      "account_name": "Cash",
      "account_category": "asset",
      "entry_date": "2025-01-15",
      "debit_amount": "1000000.00",
      "credit_amount": "0.00",
      "currency": "LKR",
      "description": "Transaction entry",
      "transaction_code": "TXN001",
      "transaction_description": "Money market deal"
    }
  ]
}
```

### 4. Financial Reports

#### Profit and Loss Statement

**Endpoint:** `GET /api/accounting/profit-loss`

**Parameters:**
- `startDate` (required) - Period start date (YYYY-MM-DD)
- `endDate` (required) - Period end date (YYYY-MM-DD)

**Response:**
```json
{
  "period": {
    "startDate": "2025-01-01",
    "endDate": "2025-01-31"
  },
  "revenue": {
    "accounts": [
      {
        "id": 10,
        "account_code": "8001",
        "name": "Interest Income",
        "balance": "5000000.00"
      }
    ],
    "total": 5000000.00
  },
  "expenses": {
    "accounts": [
      {
        "id": 20,
        "account_code": "9001",
        "name": "Brokerage Fees",
        "balance": "50000.00"
      }
    ],
    "total": 50000.00
  },
  "netProfit": 4950000.00
}
```

#### Balance Sheet

**Endpoint:** `GET /api/accounting/balance-sheet`

**Parameters:**
- `asOfDate` (required) - Balance sheet date (YYYY-MM-DD)

**Response:**
```json
{
  "asOfDate": "2025-01-31",
  "assets": {
    "accounts": [
      {
        "id": 1,
        "account_code": "1001",
        "name": "Cash",
        "balance": "10000000.00"
      }
    ],
    "total": 10000000.00
  },
  "liabilities": {
    "accounts": [...],
    "total": 2000000.00
  },
  "equity": {
    "accounts": [...],
    "retainedEarnings": 4950000.00,
    "total": 8000000.00
  },
  "totalLiabilitiesAndEquity": 10000000.00
}
```

### 5. Chart of Accounts Management

#### Get All Accounts
**Endpoint:** `GET /api/accounting/chart-of-accounts`

**Query Parameters:**
- `accountTypeId` (optional) - Filter by account type
- `category` (optional) - Filter by category (asset, liability, etc.)
- `isActive` (optional) - Filter active/inactive accounts
- `parentAccountId` (optional) - Filter by parent account

#### Create Account
**Endpoint:** `POST /api/accounting/chart-of-accounts`

**Request Body:**
```json
{
  "account_code": "1004",
  "name": "Bank Fixed Deposit",
  "account_type_id": 1,
  "parent_account_id": 1,
  "description": "Fixed deposit accounts",
  "is_active": true
}
```

#### Update Account
**Endpoint:** `PUT /api/accounting/chart-of-accounts/:id`

## Integration Points

### 1. Maturity Processing

Ledger entries are automatically created during maturity processing:

- **Principal payments**: Debit Cash, Credit Investment account
- **Interest payments**: Debit Cash, Credit Interest Income account

See `maturityController.js` functions:
- `createBorrowingMaturityEntries`
- `createLendingMaturityEntries`

### 2. Money Market Deals

Money market deal transactions trigger automatic ledger entries based on deal type and amount.

### 3. End of Day (EOD) Processing

EOD processing uses `ledgerController.postLedgerEntry` to create:
- Accrued interest entries
- Fee postings
- Settlement entries

## Default Account Structure

The migration creates a standard chart of accounts:

### Asset Accounts (1000-4999)
- `1000` - Cash and Bank (Parent)
  - `1001` - Cash
  - `1002` - Bank Current Account
  - `1003` - Bank Savings Account
- `2000` - Investments (Parent)
  - `2001` - Equity Investments
  - `2002` - Fixed Income Investments
  - `2003` - Other Investments

### Liability Accounts (5000-5999)
- `5000` - Payables (Parent)
- `6000` - Loans (Parent)

### Equity Accounts (7000-7999)
- `7000` - Capital and Reserves (Parent)

### Revenue Accounts (8000-8999)
- `8000` - Income (Parent)
  - `8001` - Interest Income
  - `8002` - Dividend Income
  - `8003` - Capital Gains

### Expense Accounts (9000-9999)
- `9000` - Expenses (Parent)
  - `9001` - Brokerage Fees
  - `9002` - Bank Charges
  - `9003` - Interest Expense

## Frontend Components

### General Ledger Viewer

**Component:** `GeneralLedger.js`

**Features:**
- View all ledger entries with pagination
- Filter by date range
- Filter by account
- Display account codes, names, and categories
- Show debit/credit amounts with proper formatting

**Usage:**
```jsx
import GeneralLedger from './components/accounting/GeneralLedger';

<GeneralLedger />
```

## Best Practices

1. **Double-Entry Validation**: Always ensure debits equal credits when creating manual entries
2. **Account Codes**: Use consistent account code numbering (assets: 1xxx, liabilities: 5xxx, etc.)
3. **Entry Dates**: Use transaction dates, not posting dates
4. **Descriptions**: Provide clear, descriptive entry descriptions for audit trail
5. **Currency**: Default to 'LKR' but support multi-currency if needed
6. **Transaction Linking**: Link entries to deal numbers for traceability

## Error Handling

The system includes validation for:
- Missing required fields
- Debit/credit imbalance
- Invalid account codes
- Duplicate account codes
- Missing account types

All errors return appropriate HTTP status codes and error messages.

## Migration

Run the accounting migration to set up tables:
```bash
node migrations/20250501-create-accounting-tables.js
```

This creates:
- `account_types` table with default types
- `chart_of_accounts` table with default accounts
- `ledger_entries` table

## Security

All endpoints require authentication via JWT token:
- Use `auth` middleware from `middlewares/auth.js`
- Ensure user has appropriate permissions for accounting operations

## Future Enhancements

Potential improvements:
- Multi-currency support with exchange rate tracking
- Recurring entries/automated journal entries
- Approval workflow for manual entries
- Audit log for entry modifications
- Export to accounting software formats (CSV, XLSX)
- Account reconciliation features
- Budget vs. actual reporting
