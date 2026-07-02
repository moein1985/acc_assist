# Ground-Truth Probe — 2026-07-02

## S23.9 — 6 Core Metrics (independent sqlcmd)

**Server:** 192.168.85.56:2211 → SQL 127.0.0.1:58033 (Sepidar01)
**Fiscal Year:** 1402
**Method:** Direct sqlcmd on remote server via SSH (plink)

| Metric | Value | Notes |
|--------|-------|-------|
| net_sales | 64,252,437,897 | SUM(NetPriceInBaseCurrency) from SLS.Invoice |
| trial_balance | 566,396,483,280 | SUM(Debit) with Type NOT IN (3,4) |
| account_balance | 0.00 | SUM(Debit-Credit) with Type NOT IN (3,4) — zero because Debit=Credit |
| total_expenses | 110,825,920,469 | SUM(Debit-Credit) code 05% with Type NOT IN (3,4) |
| cash_bank_balance | 9,521,507,066 | RPA.CashBalance + RPA.BankAccountBalance |
| receivables | -21,616,949,585 | SUM(Debit-Credit) code 02% — NOTE: 02=liabilities, needs review |

### SQL Queries (hand-written, independent of engine)

#### net_sales
```sql
SELECT SUM(NetPriceInBaseCurrency) AS Column1 FROM SLS.Invoice WHERE FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')
```

#### trial_balance
```sql
SELECT SUM(vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')
```

#### account_balance
```sql
SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')
```

#### total_expenses
```sql
SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Code LIKE '05%' AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')
```

#### cash_bank_balance
```sql
SELECT (SELECT ISNULL(SUM(Balance), 0) FROM RPA.CashBalance) + (SELECT ISNULL(SUM(Balance), 0) FROM RPA.BankAccountBalance) AS Column1
```

#### receivables
```sql
SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Code LIKE '02%' AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')
```

## S23.10 — Trial Balance A/B/C (formula dispute resolution)

| Query | Label | Value |
|-------|-------|-------|
| trial_balance_A_debit | A: SUM(Debit) with Type NOT IN (3,4) | 566,396,483,280 |
| trial_balance_B_debit_all | B: SUM(Debit) without Type filter | 894,186,424,818 |
| trial_balance_C_credit | C: SUM(Credit) with Type NOT IN (3,4) | 566,396,483,280 |
| trial_balance_B_credit_all | B: SUM(Credit) without Type filter | 894,186,424,818 |

### Analysis

- **A** (Type NOT IN 3,4): SUM(Debit) = **566,396,483,280**
- **C** (Type NOT IN 3,4): SUM(Credit) = **566,396,483,280**
- **A = C** → Debit = Credit with Type NOT IN (3,4) ✅ → **Balanced!**
- **B** (all types): SUM(Debit) = 894,186,424,818
- **B** (all types): SUM(Credit) = 894,186,424,818
- B includes closing entries (Type 3,4) which inflates the total by ~328 billion

### Conclusion

**The correct trial balance formula is A: `SUM(Debit)` with `v.Type NOT IN (3, 4)`.**

- A is balanced (Debit = Credit = 566,396,483,280) ✅
- B is also balanced but includes closing entries (894,186,424,818) — not suitable for trial balance
- The old hardcoded value in integration test (`5,426,804,727,946`) matches **neither** A nor B — it was wrong
- The value **566,396,483,280** is the correct ground-truth for trial_balance in fiscal year 1402

### Comparison with Engine Field Test (Phase 20)

| Metric | Ground-Truth (sqlcmd) | Engine (Phase 20 field test) | Match? |
|--------|----------------------|------------------------------|--------|
| net_sales | 64,252,437,897 | 64,252,437,897 | ✅ |
| trial_balance | 566,396,483,280 | — | — |
| cash_bank_balance | 9,521,507,066 | 9,521,507,066 | ✅ |
| receivables | -21,616,949,585 (02%) | 566,396,483,280 (Phase 20) | ❌ BUG |

### Issues Found

1. **Old integration test value `5426804727946` is WRONG** — doesn't match any formula
2. **Receivables query uses '02%' (liabilities)** — should use asset accounts for receivables. The Phase 20 field test returned 566,396,483,280 for receivables, which is the same as trial_balance — indicating the engine's receivables metric is also returning the wrong value
3. **account_balance = 0** — SUM(Debit-Credit) across all accounts is zero by definition (double-entry bookkeeping). The metric needs to filter by specific account or party
