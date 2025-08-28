# Buyback Workflow Implementation

## Overview
This document describes the implementation of a three-level verification workflow for buyback deals, similar to the existing GSec verification process.

## Workflow Levels

### 1. Front Office Authorizer
- **Role**: `front_office_verifier` or `front_office`
- **Action**: Reviews deals with status `Pending_Verification`
- **Approval**: Changes status to `Verified`
- **Route**: `/front-office-buyback-blotter`

### 2. Back Office Verifier
- **Role**: `back_office_verifier`
- **Action**: Reviews deals with status `Verified`
- **Approval**: Changes status to `Pending_Final_Approval`
- **Route**: `/back-office-verifier-buyback-blotter`

### 3. Back Office Final Authorizer
- **Role**: `back_office_final`
- **Action**: Reviews deals with status `Pending_Final_Approval`
- **Approval**: Changes status to `Approved`
- **Route**: `/back-office-final-buyback-blotter`

## Database Changes

### New Status
Added `Pending_Final_Approval` to the `deal_status` enum in the `buyback_deals` table.

### Migration
Run the migration script to update the database schema:
```sql
-- File: migrations/20250101-update-buyback-status-enum.sql
```

## Frontend Changes

### New Components
1. `FrontOfficeBuybackBlotter.js` - Front office verification
2. `BackOfficeVerifierBuybackBlotter.js` - Back office verification
3. `BackOfficeFinalBuybackBlotter.js` - Final authorization

### Routing
Updated `App.js` to include dynamic routing based on user roles:
- Front office users → Front Office Blotter
- Back office verifiers → Back Office Verifier Blotter
- Back office final → Back Office Final Blotter

### Admin Panel
Updated `AdminAuthorizerPanel.js` to include "Buyback" as a page option.

## Backend Changes

### Controller Updates
- `buybackDealController.js`: Updated `updateDealStatus` function to handle new workflow
- Added support for `Pending_Final_Approval` status

### Model Updates
- `buybackDealModel.js`: Updated `updateStatus` function to handle timestamp fields properly

## Testing

### Test Script
Run the test script to verify the workflow:
```bash
cd Portfolio_manager_backend
node scripts/test_buyback_workflow.js
```

### Manual Testing
1. Create a buyback deal (status: `Pending_Verification`)
2. Login as front office user and approve (status: `Verified`)
3. Login as back office verifier and approve (status: `Pending_Final_Approval`)
4. Login as back office final and approve (status: `Approved`)

## Status Flow
```
Draft → Pending_Verification → Verified → Pending_Final_Approval → Approved
```

## Troubleshooting

### Common Issues
1. **Status not updating**: Check if the database enum has been updated
2. **Deals not appearing**: Verify the status filter in the blotter
3. **Permission errors**: Check user role assignments

### Database Verification
```sql
-- Check current status enum
SHOW COLUMNS FROM buyback_deals LIKE 'deal_status';

-- Check existing deals and their statuses
SELECT deal_number, deal_status FROM buyback_deals;
```

## Security Notes
- Each level can only see deals appropriate for their role
- Status changes are logged with user ID and timestamp
- Rejection at any level sets status to `Rejected`
