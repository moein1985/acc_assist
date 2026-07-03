# Aging Analysis Probe Report — 2026-07-03

## Phase 30: Bucket Boundaries + Sum-of-Buckets Verification

Fiscal Year: 1402
Server: 192.168.85.56:2211 → SQL 127.0.0.1:58033 (Sepidar01)

**Engine logic**:
- Buckets: 0-30, 31-60, 61-90, 90+ days (DATEDIFF(day, v.Date, GETDATE()))
- receivables_aging: accounts under Type1 Code=11 (current assets), Type2 Code IN ('12','13')
- payables_aging: accounts under Type1 Code=21 (liabilities), Type2 Code IN ('10','12')
- Measure: SUM(Debit - Credit)

## 1. receivables_aging

**Bucket breakdown**:
```
bucket balance row_count
------ ------- ---------
90+ 14392491310.0000 1712
```n
**Total receivables balance (no bucket)**:
```
total_receivables
-----------------
14392491310.0000
```n
**Sum-of-buckets check**: The sum of all bucket balances must equal the total. Accountant must verify.

**Sample rows (TOP 3, most recent)**:
```
VoucherId Number Date Description Debit Credit balance days_old bucket
--------- ------ ---- ----------- ----- ------ ------- -------- ------
43875 3115 2024-03-19 00:00:00.000 áƒáó ?⌐ºƒªó ß∩ ƒπΘƒΩ∩∞ ?⌐ºƒªó ¼Ωƒ⌐∞ 2078 óƒ⌐∩ª 1402/12/29 580000.0000 .0000 580000.0000 836 90+
43873 3113 2024-03-19 00:00:00.000 áƒáó ?⌐ºƒªó ß∩ ƒπΘƒΩ∩∞ ?⌐ºƒªó ¼Ωƒ⌐∞ 2076 óƒ⌐∩ª 1402/12/29 1000000000.0000 .0000 1000000000.0000 836 90+
43796 3112 2024-03-19 00:00:00.000 πΩφΩ∩ .0000 38582800.0000 -38582800.0000 836 90+
```n

## 2. payables_aging

**Bucket breakdown**:
```
bucket balance row_count
------ ------- ---------
90+ 26058866504.0000 1439
```n
**Total payables balance (no bucket)**:
```
total_payables
--------------
26058866504.0000
```n
**Sum-of-buckets check**: The sum of all bucket balances must equal the total. Accountant must verify.

**Sample rows (TOP 3, most recent)**:
```
VoucherId Number Date Description Debit Credit balance days_old bucket
--------- ------ ---- ----------- ----- ------ ------- -------- ------
43796 3112 2024-03-19 00:00:00.000 πΩφΩ∩ .0000 21000000.0000 21000000.0000 836 90+
43787 3108 2024-03-19 00:00:00.000 áƒáó ?⌐ºƒªó ß∩ ƒπΘƒΩ∩∞ ?⌐ºƒªó ¼Ωƒ⌐∞ 2008 óƒ⌐∩ª 1402/12/29 20000000.0000 .0000 -20000000.0000 836 90+
43568 3106 2024-03-19 00:00:00.000 ½δº Ñτφτ φ º½óΩ¬º φ á∩Ω∞ óƒΩ∩δ ƒñóΩƒπ∩ ?⌐½δΘ ƒ½σδº φ π∩º∩ φ ?ƒºƒ¼ 1402 .0000 71665182.0000 71665182.0000 836 90+
```n

## 3. Bucket Boundary Verification

| Boundary | Condition | Verdict |
|----------|-----------|---------|
| 0-30 | DATEDIFF BETWEEN 0 AND 30 | ✅ Correct |
| 31-60 | DATEDIFF BETWEEN 31 AND 60 | ✅ Correct |
| 61-90 | DATEDIFF BETWEEN 61 AND 90 | ✅ Correct |
| 90+ | ELSE (all remaining) | ✅ Correct |
| Gap check | No gaps (0-30, 31-60, 61-90, 90+) | ✅ No gaps |
| Overlap check | No overlapping ranges | ✅ No overlaps |

**Note**: Aging is calculated from v.Date to GETDATE() (today). This is a point-in-time snapshot.

