# Maturity Handling API - Quick Reference

## Base URL
```
http://localhost:3001/api/maturity
```

## Authentication
```
Authorization: Bearer <your-jwt-token>
```

## Quick Endpoints

### 1. Get Maturity Deals
```http
GET /api/maturity/handling?date=2024-01-15&type=all&status=pending
```

### 2. Process Maturity Deals
```http
POST /api/maturity/process
Content-Type: application/json

{
  "dealIds": [1, 2, 3],
  "processDate": "2024-01-15",
  "bankAccountId": 123,
  "maturityAction": "principal_interest_full_payment"
}
```

### 3. Get Bank Accounts
```http
GET /api/maturity/bank-accounts
```

### 4. Get Processing History
```http
GET /api/maturity/processing-history?startDate=2024-01-01&endDate=2024-01-31
```

## Maturity Actions

| Action | Code | Auth Level | Bank Account |
|--------|------|------------|--------------|
| Principal and Interest Full Payment | `principal_interest_full_payment` | Level 2 | Required |
| Principal Reinvest + Interest Payment | `principal_reinvest_interest_paid` | Level 2 | Required |
| Full Reinvestment | `principal_interest_reinvest` | Level 3 | Not Required |
| Different Amount Reinvestment | `different_amount_reinvest` | Level 3 | Not Required |

## Response Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Continue |
| 400 | Bad Request | Check request body |
| 403 | Authorization Required | Check user permissions |
| 404 | Not Found | Check deal IDs |
| 500 | Server Error | Contact support |

## Sample Workflow

```bash
# 1. Get maturing deals
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/maturity/handling?date=2024-01-15"

# 2. Get bank accounts
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/maturity/bank-accounts"

# 3. Process deals
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "dealIds": [1, 2, 3],
    "processDate": "2024-01-15",
    "bankAccountId": 123,
    "maturityAction": "principal_interest_full_payment"
  }' \
  "http://localhost:3001/api/maturity/process"

# 4. Check processing history
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/maturity/processing-history"
```

## Error Examples

### Authorization Error
```json
{
  "success": false,
  "error": "Requires authorization level 2 for this maturity action",
  "requiresAuthorization": true,
  "authorizationLevel": "level2"
}
```

### Validation Error
```json
{
  "success": false,
  "error": "Please select a bank account for processing"
}
```

### Missing Data Error
```json
{
  "success": false,
  "error": "dealIds array is required"
}
```

## Testing with cURL

```bash
# Test bank accounts endpoint
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/maturity/bank-accounts"

# Test maturity deals endpoint
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/maturity/handling?date=2024-01-15"

# Test processing endpoint
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "dealIds": [1],
    "processDate": "2024-01-15",
    "maturityAction": "principal_interest_full_payment",
    "bankAccountId": 123
  }' \
  "http://localhost:3001/api/maturity/process"
```

## Common Issues

### 1. Authorization Error
**Problem**: "Requires authorization level X"
**Solution**: Contact admin to assign appropriate authorization level

### 2. Bank Account Required
**Problem**: "Please select a bank account for processing"
**Solution**: Include `bankAccountId` in request for methods 1 & 2

### 3. Deal Not Found
**Problem**: "Deal X not found"
**Solution**: Check deal IDs exist and are accessible

### 4. Invalid Maturity Action
**Problem**: "Invalid maturity action"
**Solution**: Use one of the 4 valid maturity action codes

## Best Practices

1. **Always check authorization level** before processing
2. **Validate deal IDs** before processing
3. **Include bank account** for methods 1 & 2
4. **Check processing history** for audit trail
5. **Handle errors gracefully** in your application
6. **Use appropriate maturity action** for your use case

## Support

- **Full Documentation**: [maturity-swagger.md](./maturity-swagger.md)
- **API Index**: [API_INDEX.md](./API_INDEX.md)
- **Swagger UI**: http://localhost:3001/api-docs
