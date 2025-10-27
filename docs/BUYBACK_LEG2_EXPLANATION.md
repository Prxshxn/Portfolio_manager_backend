# Buyback Leg2 Transaction Types Explained

## Understanding the Two Types of Buyback Transactions

### Type 1: Standard Buyback (Sell Both Legs)
**Current Example:**
```
leg1_transaction_type: Sell
leg2_transaction_type: Sell
```
- This is a **standard buyback** where you're selling bonds back
- No automatic GSec Buy deal is created
- Both legs represent sell transactions
- This is the typical buyback scenario

**When to Use:**
- You're buying back bonds you previously sold
- You're closing out a position
- You're selling back to the counterparty

### Type 2: Buyback with Leg2 = Buy (Creates GSec Automatically)
**The automatic GSec creation triggers when:**
```
leg1_transaction_type: Sell (selling old bonds)
leg2_transaction_type: Buy (buying new bonds automatically)
```
- Leg1: Sell the old bonds
- Leg2: Buy new bonds (this creates the automatic GSec Buy deal)
- The GSec Buy deal is created automatically in the `gsec` table

**When to Use:**
- You're selling old bonds AND buying new ones in one transaction
- You're rolling over a position
- You need the Buy transaction to be tracked in the GSec system

## Your Current Scenario

From your data:
```
leg1: Sell transaction (selling bonds)
leg2_transaction_type: "Sell"  ← This is why no GSec was created
```

Since both legs are "Sell", no automatic GSec Buy deal is created. This is **correct behavior**.

## To Trigger Automatic GSec Creation

You need to create a buyback with:
```
leg1_transaction_type: "Sell" (selling old bonds)
leg2_transaction_type: "Buy"  (buying new bonds - triggers auto-creation)
```

When you do this, the system will:
1. Create the buyback deal
2. Automatically create a GSec Buy deal for leg2
3. The GSec deal will appear in the Fixed Income GSec page
4. It will go through normal authorization workflow

## Decision Matrix

| Leg1 | Leg2 | Creates GSec Buy Deal? | Use Case |
|------|------|------------------------|----------|
| Sell | Sell | ❌ No | Standard buyback (sell old bonds) |
| Sell | Buy  | ✅ Yes | Rollover/Exchange (sell old, buy new) |
| Buy  | Sell | ❌ No | Purchase then sellback |
| Buy  | Buy  | ✅ Yes | Purchase and purchase (uncommon) |

## Summary

- **Your current buyback is correct** - it's a standard sell transaction
- **No GSec Buy deal is needed** because leg2 is also a Sell
- **Automatic creation only happens** when leg2.transactionType = 'Buy'
- **If you need a GSec Buy deal**, create a buyback with leg2 = 'Buy'

