# Ledger Posting Summary - Deal `20260522/GSEC/0004`

## Purpose
This document summarizes the posted ledger entries and amount calculations for deal number `20260522/GSEC/0004`.

## Posting Snapshot
- **Deal number:** `20260522/GSEC/0004`
- **Total ledger lines posted:** `42`
- **Posting window (created_at):** `2026-05-22 12:06:31 UTC` to `2026-05-22 12:06:39 UTC`
- **Entry date:** `2026-05-22`
- **Currency:** `LKR`

## Overall Balance Check
- **Total Debits:** `1,278,320,452.20`
- **Total Credits:** `1,278,320,452.24`
- **Net (Debits - Credits):** `-0.04`

Interpretation:
- The deal postings are **almost balanced**, with a **LKR 0.04 credit excess**.
- This is typically a rounding-level difference, but should be acknowledged in audit commentary.

## How The Figures Are Calculated

The sell approval logic posts entries using these formulas:

1. `Sell Dirty Amount = settlement_amount` (bank debit)
2. `Sell Clean Amount = Sell Dirty Amount - Coupon Accrued`
3. `Book Value at Sell = Treasury Bonds (Trading) + Amortised Discount/Premium`
4. `Capital Gain/Loss = Sell Clean Amount - Book Value at Sell`

For this deal, using posted totals:

- **Sell Dirty Amount (Bank Dr):** `1,253,374,800.00`
- **Coupon Accrued (Coupon Income Cr):** `24,945,652.20`
- **Sell Clean Amount:** `1,253,374,800.00 - 24,945,652.20 = 1,228,429,147.80`
- **Book Value at Sell:**
  - Treasury Bonds (Trading) Cr = `34,482,141.01`
  - Amortised Discount/Premium Cr = `65,246.76`
  - **Total Book Value** = `34,482,141.01 + 65,246.76 = 34,547,387.77`
- **Capital Gain (expected):**
  - `1,228,429,147.80 - 34,547,387.77 = 1,193,881,760.03`
- **Capital Gain posted:** `1,193,881,760.07`
- **Rounding difference:** `+0.04` (this explains the net credit excess)

Control tie-out of final approval entries:

- `Treasury Bonds + Amortisation + Coupon Income + Capital Gain`
- `34,482,141.01 + 65,246.76 + 24,945,652.20 + 1,193,881,760.07`
- `= 1,253,374,800.04` (matches final approval credit total)

### Accrued Interest Reversal Calculation

Accrued reversal is posted as a separate balanced pair:

- **Debit:** `GSec Interest Income (Accrued)` = `24,945,652.20`
- **Credit:** `GSec Accrued Interest Receivable` = `24,945,652.20`
- **Net impact of reversal:** `0.00` (pure reclassification/reversal)

## Detailed Formula Expansion (Audit Style)

### A) Final Approval - Debit Side Formula

Only one debit account is used in final approval:

- `Bank Debit Total = Sum of 6 bank debit lines`
- `= 208,895,800.00 + 208,895,800.00 + 208,895,800.00 + 208,895,800.00 + 208,895,800.00 + 208,895,800.00`
- `= 1,253,374,800.00`

### B) Final Approval - Credit Side Formula

`Final Approval Credit Total` is built from 4 components:

1. **Treasury Bonds (Trading) component**
   - `= 5,575,849.61 + 5,775,209.77 + 9,605,075.21 + 4,919,728.77 + 3,682,448.47 + 4,923,829.18`
   - `= 34,482,141.01`

2. **Amortised Discount/Premium component**
   - `= 8,989.96 + 11,949.33 + 20,586.32 + 10,898.17 + 1,856.40 + 10,966.58`
   - `= 65,246.76`

3. **Coupon Interest Income component**
   - `= 4,157,608.70 x 6`
   - `= 24,945,652.20`

4. **Capital Gain component**
   - `= 199,153,351.73 + 198,951,032.20 + 195,112,529.78 + 199,807,564.37 + 201,053,886.44 + 199,803,395.55`
   - `= 1,193,881,760.07`

So:

- `Final Approval Credit Total`
- `= 34,482,141.01 + 65,246.76 + 24,945,652.20 + 1,193,881,760.07`
- `= 1,253,374,800.04`

### C) Economic Formula Behind Capital Gain

System logic uses:

- `Capital Gain = Sell Clean Amount - Book Value at Sell`
- `Sell Clean Amount = Sell Dirty Amount - Coupon Accrued`
- `Book Value at Sell = Trading Component + Amortisation Component`

Substituting the totals:

- `Sell Clean Amount = 1,253,374,800.00 - 24,945,652.20 = 1,228,429,147.80`
- `Book Value at Sell = 34,482,141.01 + 65,246.76 = 34,547,387.77`
- `Expected Capital Gain = 1,228,429,147.80 - 34,547,387.77 = 1,193,881,760.03`
- `Posted Capital Gain = 1,193,881,760.07`
- `Rounding Delta = 1,193,881,760.07 - 1,193,881,760.03 = +0.04`

### D) Reversal Formula (Accrued Interest Reclassification)

- `Accrued Reversal Debit Total = 4,157,608.70 x 6 = 24,945,652.20`
- `Accrued Reversal Credit Total = 4,157,608.70 x 6 = 24,945,652.20`
- `Net Reversal Impact = 24,945,652.20 - 24,945,652.20 = 0.00`

### E) Full Deal Posting Identity

- `Total Deal Debits = Final Approval Debits + Reversal Debits`
- `= 1,253,374,800.00 + 24,945,652.20 = 1,278,320,452.20`

- `Total Deal Credits = Final Approval Credits + Reversal Credits`
- `= 1,253,374,800.04 + 24,945,652.20 = 1,278,320,452.24`

- `Net Difference (Dr - Cr) = 1,278,320,452.20 - 1,278,320,452.24 = -0.04`

## Description-wise Calculation

### 1) GSec Sale - Final Approval
- **Line count:** `30`
- **Debits:** `1,253,374,800.00`
- **Credits:** `1,253,374,800.04`
- **Difference (Dr - Cr):** `-0.04`

### 2) GSec Sale - Accrued Interest Reversal
- **Line count:** `12`
- **Debits:** `24,945,652.20`
- **Credits:** `24,945,652.20`
- **Difference (Dr - Cr):** `0.00`

## Account-wise Breakdown

| Account Code | Account Name | Debit Total (LKR) | Credit Total (LKR) | Lines |
|---|---|---:|---:|---:|
| `131-101-410-164-44` | Seylan Bank A/C - 0860-13374197-001 | 1,253,374,800.00 | 0.00 | 6 |
| `358-101-130-398-44` | Capital Gain on Treasury Bond | 0.00 | 1,193,881,760.07 | 6 |
| `131-101-350-098-44` | Treasury Bonds - Trading A/c | 0.00 | 34,482,141.01 | 6 |
| `467-101-190-476-44` | Coupon Interest Income TBond | 0.00 | 24,945,652.20 | 6 |
| `467-101-190-470-44` | GSec Interest Income (Accrued) | 24,945,652.20 | 0.00 | 6 |
| `131-101-290-218-44` | GSec Accrued Interest Receivable | 0.00 | 24,945,652.20 | 6 |
| `358-101-130-416-44` | Amortised Discount Received/Premium Paid TBonds - Trading | 0.00 | 65,246.76 | 6 |

## Reconciliation Math (Control Check)
- `Total Debits = 1,253,374,800.00 + 24,945,652.20 = 1,278,320,452.20`
- `Total Credits = 1,253,374,800.04 + 24,945,652.20 = 1,278,320,452.24`
- `Net Difference = 1,278,320,452.20 - 1,278,320,452.24 = -0.04`

## Suggested Management Note
For management reporting, you can state:

> Ledger postings for deal `20260522/GSEC/0004` have been captured with total debits of LKR 1,278,320,452.20 and total credits of LKR 1,278,320,452.24. The posting set is effectively balanced with an immaterial rounding difference of LKR 0.04 (credit excess).

