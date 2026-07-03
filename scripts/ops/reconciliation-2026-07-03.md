# Reconciliation Probe Report — 2026-07-03

## Phase 30: Two-Source Reconciliation Verification

Fiscal Year: 1402
Server: 192.168.85.56:2211 → SQL 127.0.0.1:58033 (Sepidar01)

| Metric | Side A | Value A | Side B | Value B | Diff (A-B) |
|--------|--------|---------|--------|---------|------------|
| sales_reconciliation | SLS.Invoice SUM(NetPriceInBaseCurrency) | 64252437897.0000 | Ledger: recursive CTE from Type1 Code=41 SUM(Credit-Debit) | 86620490903.0000 | -22368053006 |
| purchase_reconciliation | INV.InventoryReceipt SUM(TotalPrice) IsReturn=0 | 48728332354.000 | Ledger: recursive CTE from Type1 Code=62 SUM(Debit-Credit) | 3763784058.0000 | 44964548296 |
| inventory_reconciliation | INV.InventoryReceipt SUM(TotalPrice) | 48758796354.000 | Ledger: Type3 Code=03 under Type1 Code=11 SUM(Debit-Credit) | 576166373.0000 | 48182629981 |
| bank_reconciliation | RPA.BankAccountBalance SUM(Balance) | 7393606464.0000 | Ledger: Type3 Code=02 under Type1 Code=11 SUM(Debit-Credit) | 4000000000.0000 | 3393606464 |
## Analysis

### sales_reconciliation
- Side A (SLS.Invoice SUM(NetPriceInBaseCurrency)): 64252437897.0000
- Side B (Ledger: recursive CTE from Type1 Code=41 SUM(Credit-Debit)): 86620490903.0000
- Diff: -22368053006 → DISCREPANCY ⚠️
- Note: Ledger revenue may include non-invoice income (service, interest, etc.)

### purchase_reconciliation
- Side A (INV.InventoryReceipt SUM(TotalPrice) IsReturn=0): 48728332354.000
- Side B (Ledger: recursive CTE from Type1 Code=62 SUM(Debit-Credit)): 3763784058.0000
- Diff: 44964548296 → DISCREPANCY ⚠️
- Note: Ledger purchase cost (62) vs inventory receipts total — different scopes

### inventory_reconciliation
- Side A (INV.InventoryReceipt SUM(TotalPrice)): 48758796354.000
- Side B (Ledger: Type3 Code=03 under Type1 Code=11 SUM(Debit-Credit)): 576166373.0000
- Diff: 48182629981 → DISCREPANCY ⚠️
- Note: Ledger inventory account balance vs total inventory movement — different concepts

### bank_reconciliation
- Side A (RPA.BankAccountBalance SUM(Balance)): 7393606464.0000
- Side B (Ledger: Type3 Code=02 under Type1 Code=11 SUM(Debit-Credit)): 4000000000.0000
- Diff: 3393606464 → DISCREPANCY ⚠️
- Note: RPA bank balance vs ledger bank account — timing/coverage differences expected

