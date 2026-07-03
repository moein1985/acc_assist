<#
.SYNOPSIS
  Phase 30 — Cash Flow & Depreciation Probe: verify cash flow statement, direct method,
  fixed assets register, and depreciation summary.
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

$ErrorActionPreference = 'Stop'
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
$dateStr = Get-Date -Format 'yyyy-MM-dd'
$outputFile = "scripts\ops\cashflow-depreciation-probe-$dateStr.md"

Write-Host '===================================================================' -ForegroundColor Cyan
Write-Host "  CASH FLOW & DEPRECIATION PROBE — Phase 30" -ForegroundColor Cyan
Write-Host "  Server: $SshHost`:$SshPort → SQL 127.0.0.1:58033 ($SqlDatabase)" -ForegroundColor Cyan
Write-Host "  Fiscal Year: $FiscalYear" -ForegroundColor Cyan
Write-Host '===================================================================' -ForegroundColor Cyan

$report = @"
# Cash Flow & Depreciation Probe Report — $dateStr

## Phase 30: Cash Flow Statement, Direct Method, Fixed Assets, Depreciation

Fiscal Year: $FiscalYear
Server: $SshHost`:$SshPort → SQL 127.0.0.1:58033 ($SqlDatabase)

"@

# ── 1. Cash Flow Statement (indirect) — by category ───────────────────────
Write-Host "`n[1] cash_flow_statement (indirect) — by category" -ForegroundColor Yellow
$report += "`n## 1. cash_flow_statement (indirect)`n`n"
$report += "**Engine logic**: Categorize voucher items into operating/investing/financing`n`n"

$sqlCfCat = @"
SELECT cat.category, ISNULL(SUM(vi.Debit-vi.Credit),0) AS net_flow, COUNT(*) AS row_count
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId
CROSS APPLY (SELECT CASE WHEN (SELECT p1.Code FROM ACC.Account p2 JOIN ACC.Account p1 ON p2.ParentAccountRef=p1.AccountId WHERE p2.AccountId=a.ParentAccountRef)='11' THEN 'operating' WHEN (SELECT p1.Code FROM ACC.Account p2 JOIN ACC.Account p1 ON p2.ParentAccountRef=p1.AccountId WHERE p2.AccountId=a.ParentAccountRef)='12' THEN 'investing' WHEN (SELECT p1.Code FROM ACC.Account p2 JOIN ACC.Account p1 ON p2.ParentAccountRef=p1.AccountId WHERE p2.AccountId=a.ParentAccountRef) IN('21','22') THEN 'financing' ELSE 'operating' END AS category) cat
WHERE v.Type NOT IN(3,4) AND v.FiscalYearRef=$fySubquery
GROUP BY cat.category
ORDER BY cat.category
"@
$r1 = Invoke-SqlcmdRemote -Sql $sqlCfCat -Label "cf_categories"
Write-Host $r1
$report += "**By category**:`n```````n$r1`n``````n`n"

# ── 2. Cash Flow Statement — total ─────────────────────────────────────────
Write-Host "`n[2] cash_flow_statement — total" -ForegroundColor Yellow
$sqlCfTotal = @"
SELECT ISNULL(SUM(vi.Debit - vi.Credit), 0) AS total_net_flow
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId
WHERE v.Type NOT IN(3,4) AND v.FiscalYearRef=$fySubquery
"@
$r2 = Invoke-SqlcmdRemote -Sql $sqlCfTotal -Label "cf_total"
Write-Host "  Total: $r2" -ForegroundColor Green
$report += "**Total net flow**:`n```````n$r2`n``````n`n"
$report += "**Note**: Sum of categories should equal total. Accountant must verify category assignments.`n`n"

# ── 3. Cash Flow Direct ────────────────────────────────────────────────────
Write-Host "`n[3] cash_flow_direct — cash/bank accounts only" -ForegroundColor Yellow
$report += "`n## 2. cash_flow_direct`n`n"
$report += "**Engine logic**: Filter on cash/bank accounts (Type2 Code IN('01','02') under Type1 Code='11'), SUM(Debit)`n`n"

$sqlCfDirect = @"
SELECT ISNULL(SUM(vi.Debit),0) AS total_cash_in, ISNULL(SUM(vi.Credit),0) AS total_cash_out, ISNULL(SUM(vi.Debit-vi.Credit),0) AS net_cash_flow
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId
WHERE v.Type NOT IN(3,4) AND v.FiscalYearRef=$fySubquery AND a.Code IN('01','02')
"@
$r3 = Invoke-SqlcmdRemote -Sql $sqlCfDirect -Label "cf_direct"
Write-Host $r3
$report += "**Cash in/out (direct method)**:`n```````n$r3`n``````n`n"

# ── 4. Cash Flow Direct — sample rows ──────────────────────────────────────
Write-Host "`n[4] cash_flow_direct — sample rows" -ForegroundColor Yellow
$sqlCfDirectSample = @"
SELECT TOP 3 v.VoucherId, v.Number, v.Date, vi.Debit, vi.Credit, a.Code, a.Title
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId
WHERE v.Type NOT IN(3,4) AND v.FiscalYearRef=$fySubquery AND a.Code IN('01','02')
ORDER BY v.Date DESC
"@
$r4 = Invoke-SqlcmdRemote -Sql $sqlCfDirectSample -Label "cf_direct_sample"
Write-Host $r4
$report += "**Sample rows (TOP 3)**:`n```````n$r4`n``````n`n"

# ── 5. Fixed Assets Register ───────────────────────────────────────────────
Write-Host "`n[5] fixed_assets_register" -ForegroundColor Yellow
$report += "`n## 3. fixed_assets_register`n`n"
$report += "**Engine logic**: Type2 Code='06' under Type1 Code='11', SUM(Debit-Credit)`n`n"

$sqlFa = @"
SELECT ISNULL(SUM(vi.Debit-vi.Credit),0) AS fixed_assets_balance, COUNT(*) AS row_count
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId
WHERE v.Type NOT IN(3,4) AND v.FiscalYearRef=$fySubquery AND a.Code='06'
"@
$r5 = Invoke-SqlcmdRemote -Sql $sqlFa -Label "fixed_assets"
Write-Host $r5
$report += "**Fixed assets balance**:`n```````n$r5`n``````n`n"

$sqlFaSample = @"
SELECT TOP 3 v.VoucherId, v.Number, v.Date, vi.Debit, vi.Credit, a.Code, a.Title
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId
WHERE v.Type NOT IN(3,4) AND v.FiscalYearRef=$fySubquery AND a.Code='06'
ORDER BY v.Date DESC
"@
$r5s = Invoke-SqlcmdRemote -Sql $sqlFaSample -Label "fixed_assets_sample"
Write-Host $r5s
$report += "**Sample rows (TOP 3)**:`n```````n$r5s`n``````n`n"

# ── 6. Depreciation Summary ────────────────────────────────────────────────
Write-Host "`n[6] depreciation_summary" -ForegroundColor Yellow
$report += "`n## 4. depreciation_summary`n`n"
$report += "**Engine logic**: a.Title LIKE '%استهلاک%', SUM(Credit-Debit), under Type1 Code IN('11','12')`n`n"

$sqlDep = @"
SELECT ISNULL(SUM(vi.Credit-vi.Debit),0) AS accumulated_depreciation, COUNT(*) AS row_count
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId
WHERE v.Type NOT IN(3,4) AND v.FiscalYearRef=$fySubquery AND a.Title LIKE N'%استهلاک%'
"@
$r6 = Invoke-SqlcmdRemote -Sql $sqlDep -Label "depreciation"
Write-Host $r6
$report += "**Accumulated depreciation**:`n```````n$r6`n``````n`n"

# ── 7. Net Book Value check ────────────────────────────────────────────────
Write-Host "`n[7] Net Book Value = Fixed Assets - Depreciation" -ForegroundColor Yellow
$report += "`n## 5. Net Book Value Check`n`n"
$report += "**Formula**: NBV = Fixed Assets Register - Accumulated Depreciation`n"
$report += "**Note**: Accountant must verify this relationship holds.`n"

$report | Set-Content -Path $outputFile -Encoding UTF8
Write-Host "`n  Report saved to: $outputFile" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
