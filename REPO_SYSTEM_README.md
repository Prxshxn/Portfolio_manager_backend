# Repo/Reverse Repo System

## Overview
This system handles Repo and Reverse Repo transactions for the portfolio management application. It includes a complete backend infrastructure with database, models, controllers, and API endpoints.

## Database Schema

### Table: `repo_deals`
```sql
CREATE TABLE repo_deals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  deal_type ENUM('Repo', 'Reverse Repo') NOT NULL,
  counterparty_id INT NOT NULL,
  counterparty_type ENUM('corporate', 'individual', 'joint') NOT NULL,
  trade_date DATE NOT NULL,
  value_date DATE NOT NULL,
  maturity_date DATE NOT NULL,
  principal_amount DECIMAL(20,4) NOT NULL,
  interest_amount DECIMAL(20,4) NOT NULL,
  rate DECIMAL(10,4) NOT NULL,
  maturity_amount DECIMAL(20,4) NOT NULL,
  tenor INT NOT NULL,
  calculation_day_basis INT NOT NULL DEFAULT 365,
  isin_number VARCHAR(50) NOT NULL,
  issue_date VARCHAR(20),
  haircut DECIMAL(5,2) DEFAULT 0.00,
  face_value DECIMAL(20,4),
  status ENUM('Pending', 'Active', 'Matured', 'Cancelled') DEFAULT 'Pending',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_deal_type (deal_type),
  INDEX idx_counterparty (counterparty_id, counterparty_type),
  INDEX idx_trade_date (trade_date),
  INDEX idx_maturity_date (maturity_date),
  INDEX idx_status (status),
  INDEX idx_isin (isin_number)
);
```

**Note**: This table works with the existing three counterparty tables:
- `counterparty_master_corporate`
- `counterparty_master_individual` 
- `counterparty_master_joint`

The `counterparty_type` field determines which table to join with when fetching counterparty details.

## API Endpoints

### Base URL: `/api/repo-deals`

#### 1. Create Repo Deal
- **POST** `/`
- **Description**: Create a new repo or reverse repo deal
- **Body**: All deal details (dealType, counterparty, dates, amounts, etc.)
- **Response**: Created deal with ID

#### 2. Get All Repo Deals
- **GET** `/`
- **Description**: Retrieve all repo deals with optional filters
- **Query Parameters**:
  - `dealType`: Filter by deal type (Repo/Reverse Repo)
  - `status`: Filter by status
  - `counterpartyId`: Filter by counterparty
  - `startDate`: Filter deals from this date
  - `endDate`: Filter deals until this date

#### 3. Get Repo Deal by ID
- **GET** `/:id`
- **Description**: Retrieve a specific repo deal by ID
- **Response**: Deal details with counterparty and user information

#### 4. Update Repo Deal
- **PUT** `/:id`
- **Description**: Update an existing repo deal
- **Restrictions**: Cannot update matured or cancelled deals

#### 5. Delete Repo Deal
- **DELETE** `/:id`
- **Description**: Delete a repo deal
- **Restrictions**: Can only delete pending deals

#### 6. Update Deal Status
- **PATCH** `/:id/status`
- **Description**: Update the status of a repo deal
- **Body**: `{ "status": "Active|Pending|Matured|Cancelled" }`

#### 7. Get Deals by Counterparty
- **GET** `/counterparty/:counterpartyId`
- **Description**: Get all repo deals for a specific counterparty

#### 8. Get Deals by ISIN
- **GET** `/isin/:isinNumber`
- **Description**: Get all repo deals for a specific ISIN

#### 9. Get Active Deals
- **GET** `/status/active`
- **Description**: Get all currently active repo deals

#### 10. Get Expiring Deals
- **GET** `/expiring/soon`
- **Description**: Get deals expiring within specified days
- **Query Parameters**: `days` (default: 7, max: 365)

#### 11. Get Summary Statistics
- **GET** `/summary/stats`
- **Description**: Get summary statistics for all repo deals

## Business Rules

### Validation Rules
1. **Deal Type**: Must be either "Repo" or "Reverse Repo"
2. **Dates**: 
   - Value date cannot be before trade date
   - Maturity date must be after value date
3. **Amounts**: Principal amount, rate, and tenor must be positive
4. **Day Basis**: Must be either 364 or 365
5. **Status Updates**: Only pending deals can be deleted

### Status Flow
- **Pending** → **Active** → **Matured** or **Cancelled**
- Once matured or cancelled, deals cannot be updated

## Installation & Setup

### 1. Run Migration
```bash
cd Portfolio_manager_backend
node scripts/run_repo_migration.js
```

### 2. Verify Table Creation
```bash
mysql -u your_username -p your_database
SHOW TABLES LIKE 'repo_deals';
DESCRIBE repo_deals;
```

### 3. Test API Endpoints
Use Postman or similar tool to test the endpoints with sample data.

## Sample Data
The migration script includes sample data for testing:
- A Repo deal: 30-day, 6.50% rate, ₹10,00,000 principal
- A Reverse Repo deal: 58-day, 7.25% rate, ₹5,00,000 principal

## Frontend Integration

### Required Fields for Form Submission
```javascript
{
  dealType: 'Repo' | 'Reverse Repo',
  counterparty: number, // counterparty ID
  counterpartyType: 'corporate' | 'individual' | 'joint', // counterparty table type
  tradeDate: 'YYYY-MM-DD',
  valueDate: 'YYYY-MM-DD',
  maturityDate: 'YYYY-MM-DD',
  principalAmount: number,
  interestAmount: number,
  rate: number,
  maturityAmount: number,
  tenor: number,
  calculationDayBasis: 364 | 365,
  isin: string,
  issueDate: string,
  haircut: number,
  faceValue: number
}
```

### API Response Format
```javascript
{
  success: boolean,
  message: string,
  data: object | array
}
```

## Error Handling
All endpoints return consistent error responses:
```javascript
{
  success: false,
  message: 'Error description',
  error: 'Detailed error message'
}
```

## Security
- All endpoints require authentication via JWT token
- User ID is automatically captured from the authenticated user
- Input validation prevents SQL injection and invalid data

## Performance Considerations
- Database indexes on frequently queried fields
- Efficient JOIN queries with counterparties and users tables
- Pagination support for large datasets (can be added)

## Future Enhancements
1. **Audit Trail**: Track all changes to deals
2. **Workflow Management**: Approval workflows for deals
3. **Reporting**: Comprehensive reporting and analytics
4. **Integration**: Connect with external systems
5. **Notifications**: Alert system for expiring deals
6. **Bulk Operations**: Import/export functionality

## Troubleshooting

### Common Issues
1. **Foreign Key Errors**: Ensure counterparties and users tables exist
2. **Date Format Issues**: Use YYYY-MM-DD format for dates
3. **Authentication Errors**: Verify JWT token is valid and not expired

### Debug Mode
Enable detailed logging by setting environment variable:
```bash
DEBUG=repo:* node server.js
```

## Support
For technical support or questions about the repo system, refer to the development team or create an issue in the project repository.
