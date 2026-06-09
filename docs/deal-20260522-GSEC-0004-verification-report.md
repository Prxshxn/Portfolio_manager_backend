# Ledger Entry Verification Report - Deal 20260522/GSEC/0004

**Date:** 2026-05-25  
**Status:** ❌ CRITICAL ISSUES FOUND

## Executive Summary

The ledger entries for deal `20260522/GSEC/0004` have **CRITICAL DATA INTEGRITY ISSUES** that require immediate correction. The entries are **NOT POSTED CORRECTLY**.

## Issues Identified

### Issue #1: Duplicate Deal Number (CRITICAL)
- **Found:** 15 separate sell records all using the SAME deal number `20260522/GSEC/0004`
- **Expected:** Each sell transaction should have a unique deal number
- **Impact:** Impossible to track individual transactions, audit trail broken

**Evidence:**
- 15 gsec table records (IDs 383-397) all have `deal_number = '20260522/GSEC/0004'`
- Each links to a DIFFERENT buy deal
- Face values range from 855,237 to 86,752,317
- Total face value across all 15 records: **200,000,000**

### Issue #2: Incorrect Settlement Amounts (CRITICAL)
- **Found:** All 15 records show `settlement_amount = 208,895,800.00`
- **Expected:** Each allocation should have its own pro-rated settlement amount
- **Impact:** Financial figures are incorrect, reporting is broken

**Evidence:**
```
Record ID 383: face_value = 50,000,000    settlement = 208,895,800
Record ID 384: face_value = 86,752,317   settlement = 208,895,800
Record ID 385: face_value = 1,811,293    settlement = 208,895,800
... (all 15 records have identical settlement amount)
```

### Issue #3: Partial/Incorrect Posting (CRITICAL)
- **Found:** Only 6 out of 15 records generated ledger entries
- **Expected:** Either 1 aggregated posting OR 15 individual postings (one per allocation)
- **Impact:** Ledger is incomplete, amounts are duplicated

**Evidence:**
- 42 ledger entries found
- Pattern analysis shows 6 identical posting sets:
  - Bank debit: 208,895,800.00 × 6 = 1,253,374,800.00
  - Coupon income: 4,157,608.70 × 6 = 24,945,652.20
  - Capital gain varies per posting
- 9 sell records (IDs unknown) were NEVER posted to ledger

### Issue #4: Balance Out of Tolerance (HIGH)
- **Found:** Net difference of -0.04 LKR
- **Expected:** Net difference ≤ 0.01 LKR
- **Impact:** Double-entry accounting principle violated

**Evidence:**
```
Total Debits:  1,278,320,452.20
Total Credits: 1,278,320,452.24
Net Difference:            -0.04  ← EXCEEDS 0.01 tolerance
```

## Root Cause Hypothesis

Based on the evidence, the most likely scenario is:

1. **Deal Structure:** This is a **split sell** where one large sell order was allocated across multiple buy deals (FIFO/LIFO allocation)
2. **Bug in Deal Creation:** The split allocation logic incorrectly:
   - Assigned the same deal number to all 15 allocations
   - Copied the total settlement amount to each allocation instead of pro-rating
3. **Bug in Posting Logic:** The approval/posting trigger:
   - Fired 6 times (possibly once per approval level or retry)
   - Posted the same full amount 6 times instead of posting once

## Correct State (What It Should Be)

### Option A: Aggregated Posting (Recommended)
One deal `20260522/GSEC/0004` should have **ONE set of ledger entries** representing the total transaction:
- Bank debit: 208,895,800.00 (once)
- Credits: Aggregated from all 15 allocations
- 15 gsec records kept for tracking allocation details
- Link: ledger entry references main deal, gsec records reference their buy deals

### Option B: Individual Deal Numbers
Each of the 15 allocations gets its own unique deal number:
- `20260522/GSEC/0004-001` through `20260522/GSEC/0004-015`
- Each has its own pro-rated settlement amount
- Each generates its own complete set of ledger entries

## Required Actions

### Immediate (Data Correction)
1. **Delete incorrect ledger entries:**
   ```sql
   DELETE FROM ledger_entries WHERE deal_number = '20260522/GSEC/0004';
   ```

2. **Fix gsec records** - Choose one approach:
   - **Approach A:** Keep deal number, fix settlement amounts to pro-rate
   - **Approach B:** Assign unique sub-deal numbers to each allocation

### Code Fixes Required
1. **Split sell logic:** Ensure proper deal numbering for allocations
2. **Settlement calculation:** Pro-rate settlement amounts across allocations
3. **Posting logic:** Add idempotency check to prevent duplicate postings
4. **Approval workflow:** Ensure posting trigger fires exactly once

### Verification Steps
1. Query: Confirm no duplicate deal numbers exist after fix
2. Query: Verify settlement amounts match face value proportions
3. Re-post: Approve the corrected deal
4. Verify: Check ledger entries balance within 0.01 tolerance
5. Verify: Confirm entry count matches expected (1 set or 15 sets)

## Supporting Evidence Files

- Verification script: `scripts/verify-deal-20260522-GSEC-0004.js`
- Analysis script: `scripts/analyze-deal-correctness.js`
- Log file: `debug-ea67d3.log`

## Conclusion

**The ledger entries for deal 20260522/GSEC/0004 are INCORRECT and must be deleted and re-posted after fixing the underlying data issues.**

The primary issue is not the posting logic itself, but the data integrity problems in the gsec table that caused incorrect postings.

---
*Report generated: 2026-05-25*  
*Verification status: FAILED - Requires data correction and re-posting*
