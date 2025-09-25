# Maturity Handling Implementation

## Overview
This document describes the implementation of the first maturity handling action: "Maturing principal and interest paid or received in full" with three-tier authorization system.

## Features Implemented

### 1. Maturity Action: Principal and Interest Full Payment
- **Action**: Maturing principal and interest paid or received in full
- **Description**: The original transaction is completed with no continuation
- **Accounting Entries**: Proper double-entry bookkeeping for both borrowing and lending scenarios

### 2. Accounting Entries

#### For Borrowing (We owe money):
```
DR - Liability Account (Principal)
DR - Interest Expenses Account (Interest)
CR - Bank Account (Total payment)

Reversal of accumulated interest:
DR - Interest Payable - Liability
CR - Interest Accrual - P&L
```

#### For Lending (We are owed money):
```
DR - Bank Account (Total receipt)
CR - Asset Account (Principal)
CR - Interest Received Account (Interest)

Reversal of accumulated interest:
DR - Interest Accrual - P&L
CR - Interest Receivable - Asset
```

### 3. Three-Tier Authorization System

#### Authorization Levels:
- **Level 1**: Basic maturity actions (partial payments)
- **Level 2**: Principal and interest full payment, rollovers
- **Level 3**: Extensions and high-value transactions

#### Authorization Checks:
- User must have appropriate authorization level
- Deal amount limits per authorization level
- Daily processing limits
- Authorization level assignment tracking

### 4. Dynamic Bank Account Selection
- Users can select bank accounts for maturity processing
- Bank accounts are fetched from chart of accounts
- Account selection is required for principal and interest full payment

## API Endpoints

### Backend Routes:
- `POST /api/maturity/process` - Process maturity deals with authorization
- `GET /api/maturity/bank-accounts` - Get available bank accounts
- `GET /api/maturity/processing-history` - Get maturity processing history
- `GET /api/maturity/handling` - Get maturity deals for processing

### Frontend Components:
- Enhanced `MaturityHandlingPage.js` with maturity action selection
- Bank account selection dropdown
- Authorization error handling
- Process dialog with maturity action options

## Database Changes

### New Table: `maturity_processing_log`
```sql
CREATE TABLE maturity_processing_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  deal_id INT NOT NULL,
  deal_number VARCHAR(50) NOT NULL,
  maturity_action VARCHAR(100) NOT NULL,
  principal_amount DECIMAL(15,2) NOT NULL,
  interest_amount DECIMAL(15,2) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  processed_date DATE NOT NULL,
  processed_by INT NOT NULL,
  authorization_level VARCHAR(20) NOT NULL,
  bank_account_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Usage

### Processing Maturity Deals:
1. Navigate to Maturity Handling page
2. Select deals to process
3. Click "Process Selected"
4. Choose maturity action: "Maturing principal and interest paid or received in full"
5. Select bank account for processing
6. System checks authorization level
7. If authorized, processes deals and creates accounting entries
8. If not authorized, shows error with required authorization level

### Authorization Levels:
- Users must be assigned authorization levels in `authorizer_assignments` table
- Level 2 required for principal and interest full payment
- System checks deal limits and daily limits
- All processing is logged for audit trail

## Security Features:
- Three-tier authorization system
- Deal amount limits per authorization level
- Daily processing limits
- Complete audit trail of all maturity processing
- Authorization level validation before processing

## Next Steps:
The system is ready for the remaining 3 maturity actions:
1. Partial payment processing
2. Rollover functionality
3. Maturity extension handling

Each action will follow the same authorization pattern with appropriate accounting entries.
