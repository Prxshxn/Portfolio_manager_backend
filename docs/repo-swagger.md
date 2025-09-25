# Portfolio Management API - Swagger Documentation

## Overview
This document provides comprehensive Swagger/OpenAPI documentation for the Portfolio Management API endpoints. The API handles Repo and Reverse Repo transactions with full CRUD operations, status management, reporting capabilities, and maturity processing.

Additional sections include Payment Master helper endpoints used by Front Office forms (e.g., GSec) to resolve settlement modes and bank details.

## Related Documentation
- **Maturity Handling API**: [Maturity Handling Swagger Documentation](./maturity-swagger.md)
- **Repo Deals API**: This document (below)

## Base URL
```
http://localhost:3001/api/repo-deals
```

## Authentication
All endpoints require JWT Bearer token authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## API Endpoints
### Payment Master - Settlement Modes

#### Get Settlement Modes
**GET** `/api/payment-master/modes`

Returns a distinct list of settlement modes sourced from Payment Master, combining `payment_method` and `bank_payment_code`. Used to populate Settlement Mode dropdowns.

**Response (200):**
```json
{
  "success": true,
  "data": [
    { "payment_method": "RTGS", "bank_payment_code": "RTGS-SAMPATH-001" },
    { "payment_method": "CEFT", "bank_payment_code": "CEFT-COMM-002" }
  ]
}
```

**Notes:**
- Results are ordered by `payment_method`, then `bank_payment_code`.
- Records with NULL/empty `bank_payment_code` are filtered out.

#### Get Bank Details by Bank Payment Code
**GET** `/api/payment-master/bank-details/{code}`

Looks up settlement bank details for the selected bank payment code.

**Path Parameters:**
- `code` (string): The `bank_payment_code` value.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "bank_name": "Sampath Bank",
    "bank_branch": "Hq Branch",
    "bank_account_number": "1234567890"
  }
}
```

**Response (404):**
```json
{ "success": false, "error": "No bank details found for this code" }
```

**Security:**
- Same authentication requirements as other API endpoints (JWT Bearer).


### 1. Create Repo Deal
**POST** `/api/repo-deals`

Creates a new repo or reverse repo deal.

**Request Body:**
```json
{
  "dealType": "Repo",
  "counterparty": 1,
  "counterpartyType": "corporate",
  "tradeDate": "2025-01-25",
  "valueDate": "2025-01-26",
  "maturityDate": "2025-02-25",
  "principalAmount": 1000000,
  "interestAmount": 12328.77,
  "rate": 6.50,
  "maturityAmount": 1012328.77,
  "tenor": 30,
  "calculationDayBasis": 365,
  "isin": "IN1234567890",
  "issueDate": "25/01/2025",
  "haircut": 2.50,
  "faceValue": 1000000
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Repo deal created successfully",
  "data": {
    "id": 3,
    "dealType": "Repo",
    "counterparty": 1,
    "counterpartyType": "corporate",
    "status": "Pending"
  }
}
```

### 2. Get All Repo Deals
**GET** `/api/repo-deals`

Retrieves all repo deals with optional filtering.

**Query Parameters:**
- `dealType` (optional): Filter by deal type (Repo/Reverse Repo)
- `status` (optional): Filter by status (Pending/Active/Matured/Cancelled)
- `counterpartyId` (optional): Filter by counterparty ID
- `startDate` (optional): Filter deals from this date (YYYY-MM-DD)
- `endDate` (optional): Filter deals until this date (YYYY-MM-DD)

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deals retrieved successfully",
  "data": [
    {
      "id": 1,
      "dealType": "Repo",
      "counterparty": 1,
      "counterpartyType": "corporate",
      "tradeDate": "2025-01-15T18:30:00.000Z",
      "valueDate": "2025-01-16T18:30:00.000Z",
      "maturityDate": "2025-02-15T18:30:00.000Z",
      "principalAmount": "1000000.0000",
      "interestAmount": "12328.7700",
      "rate": "6.5000",
      "maturityAmount": "1012328.7700",
      "tenor": 30,
      "calculationDayBasis": 365,
      "isin": "IN1234567890",
      "issueDate": "15/01/2025",
      "haircut": "2.50",
      "faceValue": "1000000.0000",
      "status": "Active",
      "counterpartyName": "Test Corp",
      "counterpartyLongName": "Test Corporation Ltd",
      "createdByName": "admin"
    }
  ]
}
```

### 3. Get Repo Deal by ID
**GET** `/api/repo-deals/{id}`

Retrieves a specific repo deal by its ID.

**Path Parameters:**
- `id`: Unique identifier of the repo deal

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deal retrieved successfully",
  "data": {
    "id": 1,
    "dealType": "Repo",
    "counterparty": 1,
    "counterpartyType": "corporate",
    "status": "Active",
    "counterpartyName": "Test Corp",
    "counterpartyLongName": "Test Corporation Ltd",
    "createdByName": "admin"
  }
}
```

### 4. Update Repo Deal
**PUT** `/api/repo-deals/{id}`

Updates an existing repo deal. Cannot update matured or cancelled deals.

**Path Parameters:**
- `id`: Unique identifier of the repo deal to update

**Request Body:**
```json
{
  "rate": 7.00,
  "haircut": 3.00
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deal updated successfully",
  "data": {
    "id": 1,
    "rate": 7.00,
    "haircut": 3.00
  }
}
```

### 5. Delete Repo Deal
**DELETE** `/api/repo-deals/{id}`

Deletes a repo deal. Can only delete pending deals.

**Path Parameters:**
- `id`: Unique identifier of the repo deal to delete

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deal deleted successfully"
}
```

### 6. Update Deal Status
**PATCH** `/api/repo-deals/{id}/status`

Updates the status of a repo deal.

**Path Parameters:**
- `id`: Unique identifier of the repo deal

**Request Body:**
```json
{
  "status": "Active"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deal status updated successfully",
  "data": {
    "id": 1,
    "status": "Active"
  }
}
```

### 7. Get Deals by Counterparty
**GET** `/api/repo-deals/counterparty/{counterpartyId}`

Retrieves all repo deals for a specific counterparty.

**Path Parameters:**
- `counterpartyId`: ID of the counterparty

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deals retrieved successfully",
  "data": [
    {
      "id": 1,
      "dealType": "Repo",
      "counterparty": 1,
      "status": "Active"
    }
  ]
}
```

### 8. Get Deals by ISIN
**GET** `/api/repo-deals/isin/{isinNumber}`

Retrieves all repo deals for a specific ISIN number.

**Path Parameters:**
- `isinNumber`: ISIN number of the security

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deals retrieved successfully",
  "data": [
    {
      "id": 1,
      "dealType": "Repo",
      "isin": "IN1234567890",
      "status": "Active"
    }
  ]
}
```

### 9. Get Active Deals
**GET** `/api/repo-deals/status/active`

Retrieves all currently active repo deals.

**Response (200):**
```json
{
  "success": true,
  "message": "Active repo deals retrieved successfully",
  "data": [
    {
      "id": 1,
      "dealType": "Repo",
      "status": "Active",
      "maturityDate": "2025-02-15T18:30:00.000Z"
    }
  ]
}
```

### 10. Get Expiring Deals
**GET** `/api/repo-deals/expiring/soon`

Retrieves repo deals expiring within specified days.

**Query Parameters:**
- `days` (optional): Number of days to look ahead (default: 7, max: 365)

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deals expiring within 7 days retrieved successfully",
  "data": [
    {
      "id": 1,
      "dealType": "Repo",
      "status": "Active",
      "maturityDate": "2025-02-15T18:30:00.000Z"
    }
  ]
}
```

### 11. Get Summary Statistics
**GET** `/api/repo-deals/summary/stats`

Retrieves summary statistics for all repo deals.

**Response (200):**
```json
{
  "success": true,
  "message": "Repo deals summary retrieved successfully",
  "data": {
    "totalDeals": 5,
    "activeDeals": 3,
    "maturedDeals": 1,
    "pendingDeals": 1,
    "totalPrincipal": 2500000,
    "totalInterest": 45657.53,
    "avgRate": 6.75
  }
}
```

## Data Models

### RepoDeal Schema
```json
{
  "type": "object",
  "required": [
    "dealType",
    "counterparty",
    "counterpartyType",
    "tradeDate",
    "valueDate",
    "maturityDate",
    "principalAmount",
    "rate",
    "tenor",
    "calculationDayBasis",
    "isin"
  ],
  "properties": {
    "id": {
      "type": "integer",
      "description": "Auto-generated unique identifier"
    },
    "dealType": {
      "type": "string",
      "enum": ["Repo", "Reverse Repo"],
      "description": "Type of repo deal"
    },
    "counterparty": {
      "type": "integer",
      "description": "Counterparty ID from the respective counterparty table"
    },
    "counterpartyType": {
      "type": "string",
      "enum": ["corporate", "individual", "joint"],
      "description": "Type of counterparty table to reference"
    },
    "tradeDate": {
      "type": "string",
      "format": "date",
      "description": "Date when the deal was traded (YYYY-MM-DD)"
    },
    "valueDate": {
      "type": "string",
      "format": "date",
      "description": "Date when the deal becomes effective (YYYY-MM-DD)"
    },
    "maturityDate": {
      "type": "string",
      "format": "date",
      "description": "Date when the deal matures (YYYY-MM-DD)"
    },
    "principalAmount": {
      "type": "number",
      "format": "float",
      "minimum": 0,
      "description": "Principal amount of the deal"
    },
    "interestAmount": {
      "type": "number",
      "format": "float",
      "description": "Calculated interest amount"
    },
    "rate": {
      "type": "number",
      "format": "float",
      "minimum": 0,
      "description": "Interest rate percentage"
    },
    "maturityAmount": {
      "type": "number",
      "format": "float",
      "description": "Total amount at maturity (principal + interest)"
    },
    "tenor": {
      "type": "integer",
      "minimum": 0,
      "description": "Number of days from value date to maturity date"
    },
    "calculationDayBasis": {
      "type": "integer",
      "enum": [364, 365],
      "description": "Day basis for interest calculation"
    },
    "isin": {
      "type": "string",
      "description": "ISIN number of the security"
    },
    "issueDate": {
      "type": "string",
      "description": "Issue date of the security (DD/MM/YYYY format)"
    },
    "haircut": {
      "type": "number",
      "format": "float",
      "minimum": 0,
      "maximum": 100,
      "description": "Haircut percentage applied to the security"
    },
    "faceValue": {
      "type": "number",
      "format": "float",
      "minimum": 0,
      "description": "Face value of the security"
    },
    "status": {
      "type": "string",
      "enum": ["Pending", "Active", "Matured", "Cancelled"],
      "default": "Pending",
      "description": "Current status of the deal"
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
  "message": "Missing required fields",
  "error": "dealType is required"
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Authentication required",
  "error": "No token provided"
}
```

**404 Not Found:**
```json
{
  "success": false,
  "message": "Repo deal not found",
  "error": "Deal with ID 999 does not exist"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Internal server error",
  "error": "Database connection failed"
}
```

## Business Rules

### Validation Rules
1. **Deal Type**: Must be either "Repo" or "Reverse Repo"
2. **Counterparty Type**: Must be either "corporate", "individual", or "joint"
3. **Dates**: 
   - Value date cannot be before trade date
   - Maturity date must be after value date
4. **Amounts**: Principal amount, rate, and tenor must be positive
5. **Day Basis**: Must be either 364 or 365
6. **Status Updates**: Only pending deals can be deleted

### Status Flow
- **Pending** → **Active** → **Matured** or **Cancelled**
- Once matured or cancelled, deals cannot be updated

## Testing

### Swagger UI
Access the interactive API documentation at:
```
http://localhost:3001/api-docs
```

### Sample Requests
Use the examples provided in each endpoint description to test the API.

### Authentication
1. First, obtain a JWT token by calling the authentication endpoint
2. Include the token in the Authorization header for all repo deal endpoints
3. Token format: `Bearer <your-jwt-token>`

## Notes
- All dates should be in YYYY-MM-DD format for API requests
- The system automatically calculates tenor (days between value and maturity dates)
- Interest amount is calculated as: `(Principal × Rate × Tenor) / Day Basis`
- Maturity amount is calculated as: `Principal + Interest Amount`
- The API works with three counterparty tables: corporate, individual, and joint
