# Automatic GSec Deal Creation from Buyback

## Overview
When a buyback deal is created with **leg2 transaction type = 'Buy'**, the system now automatically creates a corresponding GSec deal in the `gsec` table, mirroring what happens when manually creating a buy deal in the Fixed Income GSec page.

## Implementation Details

### Location
**File:** `Portfolio_manager_backend/controllers/buybackDealController.js`
**Function:** `createDeal`

### When It Triggers
The automatic GSec creation is triggered when:
1. A buyback deal is created with `leg2.transactionType === 'Buy'`
2. The buyback deal is successfully saved to the database
3. All required data for creating a GSec deal is available

### What It Does

1. **Fetches ISIN Master Data**
   - Retrieves ISIN metadata from `isin_master` table
   - Gets coupon rates, dates, issue/maturity dates

2. **Fetches Coupon Schedule**
   - Retrieves coupon schedule from `isin_coupon_schedule` table
   - Calculates last coupon date and next coupon date based on value date

3. **Calculates Missing Fields**
   - **Coupon Interest:** Calculated from face value and coupon rate
   - **Number of Days Interest Accrued:** Days between last coupon and value date
   - **Number of Days for Coupon Period:** Days between last and next coupon

4. **Creates GSec Deal**
   - Auto-generates deal number
   - Sets transaction type to 'Buy'
   - Sets trade type to 'BuyBack'
   - Copies all relevant fields from leg2
   - Sets initial status to 'pending'
   - Starts at front_office approval level

### Field Mapping

| Leg2 Field | GSec Deal Field | Notes |
|------------|----------------|-------|
| isin | isin | Direct mapping |
| faceValue | faceValue | Direct mapping |
| valueDate | valueDate | Direct mapping |
| counterparty | counterparty | Direct mapping |
| portfolio | portfolio | Direct mapping |
| strategy | strategy | Direct mapping |
| custodian | custodian | Direct mapping |
| settlementMode | settlementMode | Direct mapping |
| cleanPrice | cleanPrice | Direct mapping |
| dirtyPrice | dirtyPrice | Direct mapping |
| accruedInterest | accruedInterest | Direct mapping |
| settlementAmount | settlementAmount | Direct mapping |
| yield | yield | Direct mapping |
| currency | currency | Uses 'LKR' as default if not provided |
| issueDate (leg1) | issueDate | From leg1 or ISIN master |
| maturityDate (leg1) | maturityDate | From leg1 or ISIN master |
| couponRate (leg1) | Used for calculation | For coupon interest calculation |

### Calculated Fields

- **nextCouponDate:** Calculated from coupon schedule based on value date
- **lastCouponDate:** Calculated from coupon schedule based on value date
- **couponInterest:** `(faceValue * couponRate) / 100`
- **numberOfDaysInterestAccrued:** Days between last coupon and value date
- **numberOfDaysForCouponPeriod:** Days between last and next coupon

### Error Handling

- If ISIN data is not found, logs a warning and skips GSec creation
- If GSec creation fails, logs error but does NOT fail the buyback creation
- The buyback deal is always created, even if automatic GSec creation fails

### Benefits

1. **Consistency:** Buy transactions are always recorded in the GSec table
2. **Automation:** Eliminates manual step of creating a separate GSec deal
3. **Data Integrity:** Ensures all buy transactions are properly tracked
4. **Workflow Integration:** The GSec deal goes through the same authorization workflow

### Important Notes

- The GSec deal created is independent of the buyback deal
- It starts at 'pending' status and goes through normal authorization workflow
- Currently, there's no foreign key linking buyback deals to GSec deals (this could be added if needed)
- All financial calculations match what's done in the manual GSec creation flow

## Testing

To test this feature:
1. Create a buyback deal with leg2 transaction type = 'Buy'
2. Check the backend console logs for:
   - "Creating automatic GSec deal for buyback leg2 (Buy transaction)..."
   - "Successfully created GSec deal with ID: [id]"
3. Check the `gsec` table for a new record with:
   - transaction_type = 'Buy'
   - trade_type = 'BuyBack'
   - Matching ISIN and portfolio
   - Status = 'pending'

## Future Enhancements

1. Add `leg2_gsec_deal_id` column to `buyback_deals` table to link the deals
2. Add UI indicator showing when a GSec deal was auto-created from buyback
3. Add option to manually create GSec deal even if leg2 is 'Sell'
4. Add validation to ensure all required fields are present before auto-creation

