# Portfolio Management System - API Documentation Index

## Overview
This document provides a comprehensive index of all available APIs in the Portfolio Management System.

## Base URLs
- **Main API**: `http://localhost:3001/api`
- **Authentication**: `http://localhost:3001/api/auth`
- **Maturity Handling**: `http://localhost:3001/api/maturity`
- **Repo Deals**: `http://localhost:3001/api/repo-deals`

## API Documentation

### 1. Authentication & User Management
- **File**: `auth-swagger.md` (to be created)
- **Endpoints**: Login, logout, user management, role assignment
- **Base URL**: `/api/auth`

### 2. Maturity Handling API
- **File**: `maturity-swagger.md` ✅
- **Endpoints**: Maturity processing, bank accounts, processing history
- **Base URL**: `/api/maturity`
- **Features**:
  - 4 maturity methods with three-tier authorization
  - Bank account selection for payment methods
  - Complete audit trail and processing history
  - Export functionality (Excel, CSV, PDF)

### 3. Repo Deals API
- **File**: `repo-swagger.md` ✅
- **Endpoints**: Repo and reverse repo transactions
- **Base URL**: `/api/repo-deals`
- **Features**:
  - Full CRUD operations for repo deals
  - Status management and reporting
  - Counterparty and ISIN filtering
  - Summary statistics

### 4. Money Market Deals API
- **File**: `money-market-swagger.md` (to be created)
- **Endpoints**: Money market transactions
- **Base URL**: `/api/money-market`
- **Features**:
  - Money market deal management
  - Interest calculations
  - Maturity processing

### 5. GSEC Deals API
- **File**: `gsec-swagger.md` (to be created)
- **Endpoints**: Government securities transactions
- **Base URL**: `/api/gsec`
- **Features**:
  - GSEC deal management
  - Bond pricing and yield calculations
  - Maturity processing

### 6. Buyback Deals API
- **File**: `buyback-swagger.md` (to be created)
- **Endpoints**: Buyback transactions
- **Base URL**: `/api/buyback`
- **Features**:
  - Buyback deal management
  - Authorization workflow
  - Maturity processing

### 7. Accounting API
- **File**: `accounting-swagger.md` (to be created)
- **Endpoints**: Chart of accounts, ledger entries, financial reports
- **Base URL**: `/api/accounting`
- **Features**:
  - Chart of accounts management
  - Double-entry bookkeeping
  - Financial reporting (P&L, Balance Sheet)
  - General ledger

### 8. Counterparty Management API
- **File**: `counterparty-swagger.md` (to be created)
- **Endpoints**: Corporate, individual, and joint counterparties
- **Base URL**: `/api/counterparties`
- **Features**:
  - Counterparty CRUD operations
  - KYC management
  - Relationship management

### 9. Reporting API
- **File**: `reporting-swagger.md` (to be created)
- **Endpoints**: Various reports and exports
- **Base URL**: `/api/reports`
- **Features**:
  - Transaction reports
  - Maturity reports
  - Performance reports
  - Regulatory reports

### 10. System Administration API
- **File**: `admin-swagger.md` (to be created)
- **Endpoints**: System configuration, user management, authorization
- **Base URL**: `/api/admin`
- **Features**:
  - User management
  - Authorization level assignment
  - System configuration
  - Audit logs

## Maturity Handling System

### Overview
The maturity handling system supports 4 different maturity processing methods with three-tier authorization:

#### Maturity Methods
1. **Principal and Interest Full Payment**
   - Complete settlement with bank movement
   - Level 2 authorization required
   - Bank account selection required

2. **Principal Reinvest + Interest Payment**
   - Principal reinvested internally, interest via bank
   - Level 2 authorization required
   - Bank account selection required

3. **Full Reinvestment**
   - Both principal and interest reinvested
   - Level 3 authorization required
   - No bank account needed

4. **Different Amount Reinvestment**
   - Reinvest different amount than maturity value
   - Level 3 authorization required
   - No bank account needed

#### Authorization Levels
- **Level 1**: Basic maturity actions
- **Level 2**: Methods 1 & 2 (with bank account)
- **Level 3**: Methods 3 & 4 (reinvestment)

#### Key Features
- ✅ Three-tier authorization system
- ✅ Bank account selection for payment methods
- ✅ Complete audit trail
- ✅ Accounting entries for each method
- ✅ Export functionality
- ✅ Processing history tracking

## API Standards

### Authentication
All APIs use JWT Bearer token authentication:
```
Authorization: Bearer <your-jwt-token>
```

### Response Format
Standard response format:
```json
{
  "success": true|false,
  "message": "Description",
  "data": {},
  "error": "Error message (if applicable)"
}
```

### Error Handling
- **400**: Bad Request (validation errors)
- **401**: Unauthorized (authentication required)
- **403**: Forbidden (authorization required)
- **404**: Not Found (resource not found)
- **500**: Internal Server Error

### Date Formats
- **API Requests**: YYYY-MM-DD
- **API Responses**: ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)

## Testing

### Swagger UI
Access interactive API documentation:
```
http://localhost:3001/api-docs
```

### Postman Collection
Import the Postman collection for testing all endpoints.

### Sample Data
Use the provided sample data files for testing:
- `sample-deals.json`
- `sample-counterparties.json`
- `sample-accounts.json`

## Development

### Adding New APIs
1. Create controller in `controllers/`
2. Create routes in `routes/`
3. Add to main router in `routes/index.js`
4. Create swagger documentation
5. Update this index

### API Versioning
- Current version: v1
- Version prefix: `/api/v1/` (optional)
- Backward compatibility maintained

## Security

### Authentication
- JWT tokens with expiration
- Refresh token mechanism
- Role-based access control

### Authorization
- Three-tier system for maturity processing
- Deal amount limits per user
- Daily processing limits
- Complete audit trail

### Data Protection
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- CORS configuration

## Monitoring

### Logging
- All API calls logged
- Error tracking and alerting
- Performance monitoring
- Audit trail for sensitive operations

### Metrics
- API response times
- Error rates
- Usage statistics
- Performance bottlenecks

## Support

### Documentation
- Swagger/OpenAPI specifications
- Postman collections
- Sample requests and responses
- Error code reference

### Contact
- Technical support: [support@company.com]
- API issues: [api-support@company.com]
- Documentation feedback: [docs@company.com]
