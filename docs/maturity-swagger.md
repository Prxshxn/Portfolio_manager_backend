# Maturity Handling API - Swagger Documentation

## Overview
This document provides comprehensive Swagger/OpenAPI documentation for the Maturity Handling API endpoints. The API handles maturity processing for all deal types (Money Market, GSEC, Repo, Buyback) with 4 different maturity methods and three-tier authorization system.

## Base URL
```
http://localhost:3001/api/maturity
```

## Authentication
All endpoints require JWT Bearer token authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Maturity Methods
The system supports 4 maturity processing methods:

1. **principal_interest_full_payment** - Maturing principal and interest paid or received in full
2. **principal_reinvest_interest_paid** - Maturing principal will be reinvested and interest will be paid or received
3. **principal_interest_reinvest** - Maturing principal and interest will both be reinvested with new terms
4. **different_amount_reinvest** - Re-investment of a different amount

## Authorization Levels
- **Level 1**: Basic maturity actions (partial payments)
- **Level 2**: Methods 1 & 2 (with bank account selection)
- **Level 3**: Methods 3 & 4 (reinvestment scenarios)

## API Endpoints

### 1. Get Maturity Deals for Processing
**GET** `/api/maturity/handling`

Retrieves all deals maturing on or before the specified date for processing.

**Query Parameters:**
- `date` (required): Maturity date filter (YYYY-MM-DD)
- `type` (optional): Deal type filter (all, gsec, money_market, repo, buyback)
- `status` (optional): Status filter (all, pending, processed, failed)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "mm-1",
      "deal_number": "MM-2024-001",
      "deal_type": "money_market",
      "isin": "LK123456789",
      "counterparty": "ABC Bank",
      "face_value": 1000000,
      "maturity_date": "2024-01-15",
      "days_to_maturity": 5,
      "status": "pending"
    }
  ]
}
```

### 2. Process Maturity Deals
**POST** `/api/maturity/process`

Processes selected maturity deals with the specified maturity action.

**Request Body:**
```json
{
  "dealIds": [1, 2, 3],
  "processDate": "2024-01-15",
  "bankAccountId": 123,
  "maturityAction": "principal_interest_full_payment"
}
```

**Request Body Parameters:**
- `dealIds` (array, required): Array of deal IDs to process
- `processDate` (string, required): Processing date (YYYY-MM-DD)
- `bankAccountId` (integer, optional): Bank account ID (required for methods 1 & 2)
- `maturityAction` (string, required): One of the 4 maturity methods

**Response (200):**
```json
{
  "success": true,
  "message": "Successfully processed 3 deals with principal and interest full payment",
  "data": [
    {
      "dealId": 1,
      "dealNumber": "MM-2024-001",
      "principalAmount": 1000000,
      "interestAmount": 5000,
      "totalAmount": 1005000
    }
  ]
}
```

**Response (403) - Authorization Error:**
```json
{
  "success": false,
  "error": "Requires authorization level 2 for this maturity action",
  "requiresAuthorization": true,
  "authorizationLevel": "level2"
}
```

### 3. Get Bank Accounts
**GET** `/api/maturity/bank-accounts`

Retrieves available bank accounts for maturity processing.

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 103,
      "account_code": "1-654-01-01-01",
      "name": "Asset CITY Bank",
      "account_type_id": 4
    },
    {
      "id": 108,
      "account_code": "1-659-01-01-01",
      "name": "Asset Bank Of Ceylon",
      "account_type_id": 4
    }
  ],
  "message": "Found 7 bank accounts"
}
```

### 4. Get Maturity Processing History
**GET** `/api/maturity/processing-history`

Retrieves maturity processing history with optional filtering.

**Query Parameters:**
- `startDate` (optional): Start date filter (YYYY-MM-DD)
- `endDate` (optional): End date filter (YYYY-MM-DD)
- `userId` (optional): Filter by user ID
- `authorizationLevel` (optional): Filter by authorization level (level1, level2, level3)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "deal_id": 123,
      "deal_number": "MM-2024-001",
      "maturity_action": "principal_interest_full_payment",
      "principal_amount": 1000000,
      "interest_amount": 5000,
      "total_amount": 1005000,
      "processed_date": "2024-01-15",
      "processed_by": 1,
      "authorization_level": "level2",
      "bank_account_id": 103,
      "processed_by_name": "admin",
      "created_at": "2024-01-15T10:30:00.000Z"
    }
  ],
  "message": "Found 1 maturity processing records"
}
```

### 5. Export Maturity Data
**GET** `/api/maturity/export`

Exports maturity data to Excel, CSV, or PDF format.

**Query Parameters:**
- `date` (required): Maturity date (YYYY-MM-DD)
- `type` (optional): Deal type filter (all, gsec, money_market, repo, buyback)
- `status` (optional): Status filter (all, pending, processed, failed)
- `format` (optional): Export format (excel, csv, pdf) - default: excel

**Response (200):**
- Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
- Content-Disposition: attachment; filename="maturity-handling-2024-01-15.xlsx"
- Body: Binary file content

### 6. Get Money Market Maturities
**GET** `/api/maturity/money-market`

Retrieves money market deals maturing up to a specific date.

**Query Parameters:**
- `date` (required): Maturity date (YYYY-MM-DD)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "deal_number": "MM-2024-001",
      "principal_amount": 1000000,
      "maturity_date": "2024-01-15",
      "counterparty_name": "ABC Bank"
    }
  ],
  "message": "Found 1 money market deals maturing up to 2024-01-15"
}
```

### 7. Get GSEC Maturities
**GET** `/api/maturity/fixed-income-gsec`

Retrieves GSEC deals maturing up to a specific date.

**Query Parameters:**
- `date` (required): Maturity date (YYYY-MM-DD)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "deal_number": "GSEC-2024-001",
      "face_value": 1000000,
      "maturity_date": "2024-01-15",
      "counterparty_name": "ABC Bank"
    }
  ],
  "message": "Found 1 GSEC deals maturing up to 2024-01-15"
}
```

### 8. Get Maturity Summary
**GET** `/api/maturity/summary`

Retrieves summary statistics for maturity deals.

**Query Parameters:**
- `date` (required): Maturity date (YYYY-MM-DD)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "moneyMarket": {
      "totalDeals": 5,
      "totalPrincipal": 5000000,
      "deals7Days": 2,
      "deals30Days": 4
    },
    "gsec": {
      "totalDeals": 3,
      "totalFaceValue": 3000000,
      "deals7Days": 1,
      "deals30Days": 2
    },
    "total": {
      "totalDeals": 8,
      "totalValue": 8000000
    }
  },
  "message": "Maturity summary for 2024-01-15"
}
```

## Data Models

### Maturity Deal Schema
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique identifier for the deal"
    },
    "deal_number": {
      "type": "string",
      "description": "Deal number"
    },
    "deal_type": {
      "type": "string",
      "enum": ["money_market", "gsec", "repo", "buyback"],
      "description": "Type of deal"
    },
    "isin": {
      "type": "string",
      "description": "ISIN number"
    },
    "counterparty": {
      "type": "string",
      "description": "Counterparty name"
    },
    "face_value": {
      "type": "number",
      "description": "Face value of the deal"
    },
    "maturity_date": {
      "type": "string",
      "format": "date",
      "description": "Maturity date (YYYY-MM-DD)"
    },
    "days_to_maturity": {
      "type": "integer",
      "description": "Days remaining to maturity"
    },
    "status": {
      "type": "string",
      "enum": ["pending", "processed", "failed"],
      "description": "Processing status"
    }
  }
}
```

### Maturity Processing Request Schema
```json
{
  "type": "object",
  "required": ["dealIds", "processDate", "maturityAction"],
  "properties": {
    "dealIds": {
      "type": "array",
      "items": {
        "type": "integer"
      },
      "description": "Array of deal IDs to process"
    },
    "processDate": {
      "type": "string",
      "format": "date",
      "description": "Processing date (YYYY-MM-DD)"
    },
    "bankAccountId": {
      "type": "integer",
      "description": "Bank account ID (required for methods 1 & 2)"
    },
    "maturityAction": {
      "type": "string",
      "enum": [
        "principal_interest_full_payment",
        "principal_reinvest_interest_paid",
        "principal_interest_reinvest",
        "different_amount_reinvest"
      ],
      "description": "Maturity processing method"
    }
  }
}
```

### Bank Account Schema
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "integer",
      "description": "Account ID"
    },
    "account_code": {
      "type": "string",
      "description": "Account code"
    },
    "name": {
      "type": "string",
      "description": "Account name"
    },
    "account_type_id": {
      "type": "integer",
      "description": "Account type ID"
    }
  }
}
```

### Maturity Processing Log Schema
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "integer",
      "description": "Log entry ID"
    },
    "deal_id": {
      "type": "integer",
      "description": "Deal ID"
    },
    "deal_number": {
      "type": "string",
      "description": "Deal number"
    },
    "maturity_action": {
      "type": "string",
      "description": "Maturity action performed"
    },
    "principal_amount": {
      "type": "number",
      "description": "Principal amount"
    },
    "interest_amount": {
      "type": "number",
      "description": "Interest amount"
    },
    "total_amount": {
      "type": "number",
      "description": "Total amount"
    },
    "processed_date": {
      "type": "string",
      "format": "date",
      "description": "Processing date"
    },
    "processed_by": {
      "type": "integer",
      "description": "User ID who processed"
    },
    "authorization_level": {
      "type": "string",
      "enum": ["level1", "level2", "level3"],
      "description": "Authorization level used"
    },
    "bank_account_id": {
      "type": "integer",
      "description": "Bank account used"
    },
    "processed_by_name": {
      "type": "string",
      "description": "Name of user who processed"
    },
    "created_at": {
      "type": "string",
      "format": "date-time",
      "description": "Creation timestamp"
    }
  }
}
```

## Error Responses

### Common Error Codes

**400 Bad Request:**
```json
{
  "success": false,
  "error": "dealIds array is required"
}
```

**403 Forbidden - Authorization Required:**
```json
{
  "success": false,
  "error": "Requires authorization level 2 for this maturity action",
  "requiresAuthorization": true,
  "authorizationLevel": "level2"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Deal 999 not found"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Database connection failed"
}
```

## Business Rules

### Maturity Processing Rules
1. **Authorization**: Users must have appropriate authorization level for the maturity action
2. **Bank Account**: Required for methods 1 & 2 (full payment and principal reinvest with interest payment)
3. **Deal Limits**: Users have per-deal and daily processing limits based on authorization level
4. **Accounting**: Each maturity method creates specific accounting entries
5. **Audit Trail**: All processing is logged with user, timestamp, and authorization level

### Authorization Levels
- **Level 1**: Basic maturity actions (partial payments)
- **Level 2**: Methods 1 & 2 (principal and interest full payment, principal reinvest with interest payment)
- **Level 3**: Methods 3 & 4 (full reinvestment, different amount reinvestment)

### Accounting Entries
Each maturity method creates specific double-entry accounting entries:

#### Method 1: Principal and Interest Full Payment
**Borrowing:**
- DR Liability Account (Principal)
- DR Interest Expenses (Interest)
- CR Bank Account (Total Payment)
- Interest Reversals

**Lending:**
- DR Bank Account (Total Receipt)
- CR Asset Account (Principal)
- CR Interest Received (Interest)
- Interest Reversals

#### Method 2: Principal Reinvest + Interest Payment
**Borrowing:**
- Pay interest via bank
- Reinvest principal internally
- Interest Reversals

**Lending:**
- Receive interest via bank
- Reinvest principal internally
- Interest Reversals

#### Method 3: Full Reinvestment
- Close existing positions
- Prepare for new investment
- No bank movement

#### Method 4: Different Amount Reinvestment
- Close existing positions
- Prepare for different amount investment
- No bank movement

## Testing

### Swagger UI
Access the interactive API documentation at:
```
http://localhost:3001/api-docs
```

### Sample Workflow
1. **Get Maturity Deals**: `GET /api/maturity/handling?date=2024-01-15`
2. **Get Bank Accounts**: `GET /api/maturity/bank-accounts`
3. **Process Deals**: `POST /api/maturity/process` with maturity action
4. **Check History**: `GET /api/maturity/processing-history`

### Authentication
1. Obtain JWT token from authentication endpoint
2. Include token in Authorization header: `Bearer <your-jwt-token>`
3. Ensure user has appropriate authorization level for maturity actions

## Notes
- All dates should be in YYYY-MM-DD format
- Bank account selection is required for methods 1 & 2
- Authorization level determines which maturity methods are available
- All processing creates complete audit trail
- Accounting entries are posted after successful authorization
- System supports both borrowing and lending scenarios
