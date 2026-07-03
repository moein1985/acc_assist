<#
.SYNOPSIS
  Discover what account types/levels voucher items reference, and test recursive hierarchy queries.
#>
param(
  [string]$SshHost = '192.168.85.56',
  [int]$SshPort = 2211,
  [string]$SshUser = 'administrator',
  [string]$SshPassword = 'Hs-co@12321#',
  [string]$HostKey = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ',
  [string]$SqlUser = 'damavand',
  [string]$SqlPassword = 'damavand',
  [string]$SqlDatabase = 'Sepidar01',
  [string]$FiscalYear = '1402'
)

$PlinkExe = 'C:\Program Files\PuTTY\plink.exe'

function Invoke-SqlcmdRemote {
  param([string]$Sql, [string]$Label)
  Write-Host "  [$Label] executing..." -NoNewline
  $sqlBytes = [Text.Encoding]::Unicode.GetBytes($Sql)
  $sqlB64 = [Convert]::ToBase64String($sqlBytes)
  $remoteScript = "`$ErrorActionPreference = 'Stop';"
  $remoteScript += "`$sql = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('$sqlB64'));"
  $remoteScript += "`$tmpFile = [IO.Path]::GetTempFileName() + '.sql';"
  $remoteScript += "Set-Content -Path `$tmpFile -Value ('SET NOCOUNT ON;`r`n' + `$sql) -Encoding Unicode -NoNewline;"
  $remoteScript += "try {"
  $remoteScript += "  `$raw = & sqlcmd -S 127.0.0.1,58033 -U $SqlUser -P $SqlPassword -d $SqlDatabase -i `$tmpFile -W 2>&1;"
  $remoteScript += "  Remove-Item `$tmpFile -ErrorAction SilentlyContinue;"
  $remoteScript += "  Write-Output (`$raw | Out-String);"
  $remoteScript += "} catch {"
  $remoteScript += "  Remove-Item `$tmpFile -ErrorAction SilentlyContinue;"
  $remoteScript += "  Write-Output ('ERROR:' + `$_.Exception.Message)"
  $remoteScript += "}"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
  $raw = & $PlinkExe -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" "powershell -NoProfile -EncodedCommand $encoded" 2>&1
  $out = ($raw | Out-String).Trim()
  Write-Host " done" -ForegroundColor Green
  return $out
}

$fySubquery = "(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$FiscalYear')"

Write-Host "=== 1. What account types do voucher items reference? ===" -ForegroundColor Cyan
$sql1 = @"
SELECT a.Type, COUNT(*) AS cnt, SUM(vi.Debit) AS totalDebit, SUM(vi.Credit) AS totalCredit
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
GROUP BY a.Type
ORDER BY a.Type
"@
$r1 = Invoke-SqlcmdRemote -Sql $sql1 -Label "voucher_account_types"
Write-Host $r1

Write-Host "`n=== 2. Recursive CTE: all descendants of Type1 Code=41 (revenue) ===" -ForegroundColor Cyan
$sql2 = @"
WITH AccountTree AS (
  SELECT AccountId, Code, Title, Type, ParentAccountRef, 0 AS Lvl
  FROM ACC.Account WHERE Type = 1 AND Code = '41'
  UNION ALL
  SELECT a.AccountId, a.Code, a.Title, a.Type, a.ParentAccountRef, t.Lvl + 1
  FROM ACC.Account a JOIN AccountTree t ON a.ParentAccountRef = t.AccountId
)
SELECT Lvl, Type, COUNT(*) AS cnt FROM AccountTree GROUP BY Lvl, Type ORDER BY Lvl, Type
"@
$r2 = Invoke-SqlcmdRemote -Sql $sql2 -Label "revenue_tree"
Write-Host $r2

Write-Host "`n=== 3. Sum voucher items for revenue accounts (recursive) ===" -ForegroundColor Cyan
$sql3 = @"
WITH AccountTree AS (
  SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '41'
  UNION ALL
  SELECT a.AccountId FROM ACC.Account a JOIN AccountTree t ON a.ParentAccountRef = t.AccountId
)
SELECT ISNULL(SUM(vi.Credit - vi.Debit), 0) AS revenue_from_ledger
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN AccountTree at ON vi.AccountSLRef = at.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
"@
$r3 = Invoke-SqlcmdRemote -Sql $sql3 -Label "revenue_ledger_sum"
Write-Host $r3

Write-Host "`n=== 4. Sum voucher items for purchase cost accounts (Type1 Code=62, recursive) ===" -ForegroundColor Cyan
$sql4 = @"
WITH AccountTree AS (
  SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '62'
  UNION ALL
  SELECT a.AccountId FROM ACC.Account a JOIN AccountTree t ON a.ParentAccountRef = t.AccountId
)
SELECT ISNULL(SUM(vi.Debit - vi.Credit), 0) AS purchase_from_ledger
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN AccountTree at ON vi.AccountSLRef = at.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
"@
$r4 = Invoke-SqlcmdRemote -Sql $sql4 -Label "purchase_ledger_sum"
Write-Host $r4

Write-Host "`n=== 5. Sum voucher items for inventory accounts (Type1 Code=11, recursive) ===" -ForegroundColor Cyan
$sql5 = @"
WITH AccountTree AS (
  SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '11'
  UNION ALL
  SELECT a.AccountId FROM ACC.Account a JOIN AccountTree t ON a.ParentAccountRef = t.AccountId
)
SELECT ISNULL(SUM(vi.Debit - vi.Credit), 0) AS inventory_from_ledger
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN AccountTree at ON vi.AccountSLRef = at.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
"@
$r5 = Invoke-SqlcmdRemote -Sql $sql5 -Label "inventory_ledger_sum"
Write-Host $r5

Write-Host "`n=== 6. Bank accounts: find Type2 children of Type1 Code=11 with Code containing 'bank' ===" -ForegroundColor Cyan
$sql6 = @"
SELECT a2.AccountId, a2.Code, a2.Title, a2.Type
FROM ACC.Account a2
JOIN ACC.Account a1 ON a2.ParentAccountRef = a1.AccountId
WHERE a1.Type = 1 AND a1.Code = '11' AND a2.Type = 2
ORDER BY a2.Code
"@
$r6 = Invoke-SqlcmdRemote -Sql $sql6 -Label "bank_type2"
Write-Host $r6

Write-Host "`n=== 7. Bank: recursive from Type1 Code=11, filter Type3 Code='02' ===" -ForegroundColor Cyan
$sql7 = @"
WITH AccountTree AS (
  SELECT AccountId, Code, Type FROM ACC.Account WHERE Type = 1 AND Code = '11'
  UNION ALL
  SELECT a.AccountId, a.Code, a.Type FROM ACC.Account a JOIN AccountTree t ON a.ParentAccountRef = t.AccountId
)
SELECT ISNULL(SUM(vi.Debit - vi.Credit), 0) AS bank_from_ledger
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN AccountTree at ON vi.AccountSLRef = at.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery AND at.Code = '02' AND at.Type = 3
"@
$r7 = Invoke-SqlcmdRemote -Sql $sql7 -Label "bank_ledger_sum"
Write-Host $r7

Write-Host "`n=== 8. Bank: recursive from all Type1 Code=11 descendants (no Code filter) ===" -ForegroundColor Cyan
$sql8 = @"
WITH AccountTree AS (
  SELECT AccountId, Code, Type FROM ACC.Account WHERE Type = 1 AND Code = '11'
  UNION ALL
  SELECT a.AccountId, a.Code, a.Type FROM ACC.Account a JOIN AccountTree t ON a.ParentAccountRef = t.AccountId
)
SELECT at.Type, at.Code, COUNT(*) AS voucherCount, ISNULL(SUM(vi.Debit - vi.Credit), 0) AS balance
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN AccountTree at ON vi.AccountSLRef = at.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
GROUP BY at.Type, at.Code
ORDER BY at.Type, at.Code
"@
$r8 = Invoke-SqlcmdRemote -Sql $sql8 -Label "current_assets_breakdown"
Write-Host $r8
