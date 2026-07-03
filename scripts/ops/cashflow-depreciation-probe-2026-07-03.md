# Cash Flow & Depreciation Probe Report — 2026-07-03

## Phase 30: Cash Flow Statement, Direct Method, Fixed Assets, Depreciation

Fiscal Year: 1402
Server: 192.168.85.56:2211 → SQL 127.0.0.1:58033 (Sepidar01)

## 1. cash_flow_statement (indirect)

**Engine logic**: Categorize voucher items into operating/investing/financing

**By category**:
```
category net_flow row_count
-------- -------- ---------
financing -23079836748.0000 1446
investing 3950002153.0000 24
operating 19129834595.0000 6707
```n
**Total net flow**:
```
total_net_flow
--------------
.0000
```n
**Note**: Sum of categories should equal total. Accountant must verify category assignments.


## 2. cash_flow_direct

**Engine logic**: Filter on cash/bank accounts (Type2 Code IN('01','02') under Type1 Code='11'), SUM(Debit)

**Cash in/out (direct method)**:
```
total_cash_in total_cash_out net_cash_flow
------------- -------------- -------------
208849015830.0000 337078775501.0000 -128229759671.0000
```n
**Sample rows (TOP 3)**:
```
VoucherId Number Date Debit Credit Code Title
--------- ------ ---- ----- ------ ---- -----
43874 3114 2024-03-19 00:00:00.000 30000.0000 .0000 02 ∞¬∩δ∞ Φƒ⌐Ω¬º ªºΩƒó áƒδΦ∩
43873 3113 2024-03-19 00:00:00.000 1000000000.0000 .0000 01 Ñ½ƒá∞ƒ∩ º⌐∩ƒσóδ∩
43796 3112 2024-03-19 00:00:00.000 .0000 38582800.0000 01 Ñ½ƒá∞ƒ∩ º⌐∩ƒσóδ∩
```n

## 3. fixed_assets_register

**Engine logic**: Type2 Code='06' under Type1 Code='11', SUM(Debit-Credit)

**Fixed assets balance**:
```
fixed_assets_balance row_count
-------------------- ---------
8188904704.0000 226
```n
**Sample rows (TOP 3)**:
```
VoucherId Number Date Debit Credit Code Title
--------- ------ ---- ----- ------ ---- -----
43568 3106 2024-03-19 00:00:00.000 .0000 67967041.0000 06 Ñτφτ φ º½óΩ¬º ?⌐ºƒªóδ∩
43568 3106 2024-03-19 00:00:00.000 .0000 100000000.0000 06 Ñτφτ φ º½óΩ¬º ?⌐ºƒªóδ∩
43568 3106 2024-03-19 00:00:00.000 .0000 20000000.0000 06 Ñτφτ φ º½óΩ¬º ?⌐ºƒªóδ∩
```n

## 4. depreciation_summary

**Engine logic**: a.Title LIKE '%استهلاک%', SUM(Credit-Debit), under Type1 Code IN('11','12')

**Accumulated depreciation**:
```
accumulated_depreciation row_count
------------------------ ---------
.0000 0
```n

## 5. Net Book Value Check

**Formula**: NBV = Fixed Assets Register - Accumulated Depreciation
**Note**: Accountant must verify this relationship holds.

