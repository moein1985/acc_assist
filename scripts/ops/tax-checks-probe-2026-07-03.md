# Tax & Checks Probe Report — 2026-07-03

## Phase 30: VAT Rate Verification + Tax/Check Metric Sampling

Fiscal Year: 1402
Server: 192.168.85.56:2211 → SQL 127.0.0.1:58033 (Sepidar01)

## 1. VAT Rate Analysis

**Engine logic**: vat_detailed uses CASE WHEN VatAmount > 0 THEN 'standard' ELSE 'exempt'

**VAT breakdown**:
```
Msg 207, Level 16, State 1, Server RD-S\SEPIDAR, Line 12
Invalid column name 'VatAmount'.
Msg 207, Level 16, State 1, Server RD-S\SEPIDAR, Line 3
Invalid column name 'VatAmount'.
```n
**Expected**: standard rate ~9% (Iran VAT), exempt = 0%


## 2. tax_monthly_summary

**Monthly tax breakdown**:
```
Msg 207, Level 16, State 1, Server RD-S\SEPIDAR, Line 7
Invalid column name 'IssueDate'.
Msg 207, Level 16, State 1, Server RD-S\SEPIDAR, Line 2
Invalid column name 'IssueDate'.
```n

## 3. invoices_without_tax

**Count**: no_tax_count
------------
136

**Sample (TOP 3)**:
```
InvoiceId Number Date CustomerRealName NetPriceInBaseCurrency TaxInBaseCurrency
--------- ------ ---- ---------------- ---------------------- -----------------
3263 214 2024-03-10 00:00:00.000 ∞óΘ σα∩Θó (σ∞Ωδ º?) 752000000.0000 .0000
3265 216 2024-03-10 00:00:00.000 ƒΩφƒñ ?½ó⌐(Öτƒ∩ δπ∩Ω Öáƒº∩ ) 1540300000.0000 .0000
3260 211 2024-03-06 00:00:00.000 Öτƒ∩ πΘ∩ ƒ∩Ωƒδ∩ ?φ⌐ 190970000.0000 .0000
```n

## 4. vat_liability

**Total output VAT (from invoices)**:
```
total_output_vat
----------------
2029051751.0000
```n

## 5. tax_liability_summary (from ledger)

**Tax ledger balance (Credit-Debit)**:
```
tax_ledger_balance
------------------
.0000
```n
**Note**: Output VAT (invoices) vs ledger tax balance — reconciliation needed by accountant


## 6. checks_due

**Engine logic**: RPA.ReceiptCheque UNION RPA.PaymentCheque, Status=1 (in-process)

**Count + Total (Status=1)**:
```
due_count due_total
--------- ---------
1173 315311283639.0000
```n
**Sample (TOP 3)**:
```
direction CheckId Number DueDate Amount State
--------- ------- ------ ------- ------ -----
receipt 1196 99 2026-05-15 00:00:00.000 100000000.0000 1
receipt 1195 98 2026-04-14 00:00:00.000 100000000.0000 1
receipt 1194 97 2026-03-16 00:00:00.000 100000000.0000 1
```n

## 7. checks_bounced

**Count + Total (Status=2)**:
```
bounced_count bounced_total
------------- -------------
162 57747937856.0000
```n
**Sample (TOP 3)**:
```
direction CheckId Number DueDate Amount State
--------- ------- ------ ------- ------ -----
receipt 1189 92 2025-11-14 00:00:00.000 1000000000.0000 2
receipt 1207 100 2025-11-10 00:00:00.000 1500000000.0000 2
payment 1452 440755 2025-03-16 00:00:00.000 3000000000.0000 2
```n

## 8. checks_summary

**Summary by state**:
```
State cnt total
----- --- -----
1 1173 315311283639.0000
2 162 57747937856.0000
4 255 66787536645.0000
8 140 53053340000.0000
16 175 16892945679.0000
32 170 30439760406.0000
64 60 14045577657.0000
```n
**States**: 1=in-process, 2=bounced, others as defined in Sepidar

