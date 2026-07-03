# Anomaly Detection Probe Report — 2026-07-03

## Phase 30: Row-Level Sampling for Anomaly Metrics

Fiscal Year: 1402
Server: 192.168.85.56:2211 → SQL 127.0.0.1:58033 (Sepidar01)

## 1. unbalanced_vouchers

**Engine logic**: GROUP BY v.VoucherId, HAVING SUM(Debit) <> SUM(Credit)

**Count**: unbalanced_count
----------------
0

**Sample rows (TOP 3)**:
```
VoucherId Number Date Description TotalDebit TotalCredit Diff
--------- ------ ---- ----------- ---------- ----------- ----
```n

## 2. zero_amount_invoices

**Engine logic**: SELECT FROM SLS.Invoice WHERE NetPriceInBaseCurrency = 0

**Count**: zero_count
----------
0

**Sample rows (TOP 3)**:
```
InvoiceId Number Date NetPriceInBaseCurrency CustomerRealName
--------- ------ ---- ---------------------- ----------------
```n

## 3. duplicate_vouchers

**Engine logic**: GROUP BY v.Date, v.Description, HAVING COUNT(*) > 1, v.Type IN (1,2)

**Count**: dup_count
---------
3113

**Sample rows (TOP 3)**:
```
Date Description cnt TotalDebit
---- ----------- --- ----------
2024-03-19 00:00:00.000 áƒáó ?⌐ºƒªó ß∩ ƒπΘƒΩ∩∞ ?⌐ºƒªó ¼Ωƒ⌐∞ 2007 óƒ⌐∩ª 1402/12/29 2 120000720.0000
2024-03-19 00:00:00.000 áƒáó ?⌐ºƒªó ß∩ ƒπΘƒΩ∩∞ ?⌐ºƒªó ¼Ωƒ⌐∞ 2008 óƒ⌐∩ª 1402/12/29 2 20000000.0000
2024-03-19 00:00:00.000 áƒáó ?⌐ºƒªó ß∩ ƒπΘƒΩ∩∞ ?⌐ºƒªó ¼Ωƒ⌐∞ 2009 óƒ⌐∩ª 1402/12/29 2 360.0000
```n

## 4. vouchers_without_account

**Engine logic**: WHERE vi.AccountSLRef IS NULL OR vi.AccountSLRef = 0

**Count**: no_account_count
----------------
0

**Sample rows (TOP 3)**:
```
VoucherItemId Number Date Description Debit Credit
------------- ------ ---- ----------- ----- ------
```n

## Summary

| Metric | Count | Sample Rows | Verdict |
|--------|-------|-------------|---------|
| unbalanced_vouchers | unbalanced_count
----------------
0 | TOP 3 | Needs accountant review |
| zero_amount_invoices | zero_count
----------
0 | TOP 3 | Needs accountant review |
| duplicate_vouchers | dup_count
---------
3113 | TOP 3 | Needs accountant review |
| vouchers_without_account | no_account_count
----------------
0 | TOP 3 | Needs accountant review |

