<#
.SYNOPSIS
  Phase 30 — Anomaly Detection Probe: row-level sampling for anomaly metrics.
  Verifies unbalanced_vouchers, zero_amount_invoices, duplicate_vouchers, vouchers_without_account.
  Samples >=3 rows for each metric to prove the engine logic is correct.
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
$outputFile = "scripts\ops\anomaly-probe-$dateStr.md"

Write-Host '===================================================================' -ForegroundColor Cyan
Write-Host "  ANOMALY DETECTION PROBE — Phase 30" -ForegroundColor Cyan
Write-Host "  Server: $SshHost`:$SshPort → SQL 127.0.0.1:58033 ($SqlDatabase)" -ForegroundColor Cyan
Write-Host "  Fiscal Year: $FiscalYear" -ForegroundColor Cyan
Write-Host '===================================================================' -ForegroundColor Cyan

$report = @"
# Anomaly Detection Probe Report — $dateStr

## Phase 30: Row-Level Sampling for Anomaly Metrics

Fiscal Year: $FiscalYear
Server: $SshHost`:$SshPort → SQL 127.0.0.1:58033 ($SqlDatabase)

"@

# ── 1. Unbalanced Vouchers ─────────────────────────────────────────────────
Write-Host "`n[1] unbalanced_vouchers" -ForegroundColor Yellow
$report += "`n## 1. unbalanced_vouchers`n`n"
$report += "**Engine logic**: GROUP BY v.VoucherId, HAVING SUM(Debit) <> SUM(Credit)`n`n"

$sql1Count = @"
SELECT COUNT(*) AS unbalanced_count
FROM (
  SELECT v.VoucherId, SUM(vi.Debit) AS dr, SUM(vi.Credit) AS cr
  FROM ACC.VoucherItem vi
  JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
  WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
  GROUP BY v.VoucherId
  HAVING SUM(vi.Debit) <> SUM(vi.Credit)
) t
"@
$r1c = Invoke-SqlcmdRemote -Sql $sql1Count -Label "unbalanced_count"
Write-Host "  Count: $r1c" -ForegroundColor Green
$report += "**Count**: $r1c`n`n"

$sql1Sample = @"
SELECT TOP 3 v.VoucherId, v.Number, v.Date, v.Description,
  SUM(vi.Debit) AS TotalDebit, SUM(vi.Credit) AS TotalCredit,
  SUM(vi.Debit) - SUM(vi.Credit) AS Diff
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
GROUP BY v.VoucherId, v.Number, v.Date, v.Description
HAVING SUM(vi.Debit) <> SUM(vi.Credit)
ORDER BY v.Date DESC
"@
$r1s = Invoke-SqlcmdRemote -Sql $sql1Sample -Label "unbalanced_sample"
Write-Host "  Sample (TOP 3):" -ForegroundColor Green
Write-Host $r1s
$report += "**Sample rows (TOP 3)**:`n```````n$r1s`n``````n`n"

# ── 2. Zero Amount Invoices ────────────────────────────────────────────────
Write-Host "`n[2] zero_amount_invoices" -ForegroundColor Yellow
$report += "`n## 2. zero_amount_invoices`n`n"
$report += "**Engine logic**: SELECT FROM SLS.Invoice WHERE NetPriceInBaseCurrency = 0`n`n"

$sql2Count = @"
SELECT COUNT(*) AS zero_count
FROM SLS.Invoice
WHERE NetPriceInBaseCurrency = 0 AND FiscalYearRef = $fySubquery
"@
$r2c = Invoke-SqlcmdRemote -Sql $sql2Count -Label "zero_invoice_count"
Write-Host "  Count: $r2c" -ForegroundColor Green
$report += "**Count**: $r2c`n`n"

$sql2Sample = @"
SELECT TOP 3 InvoiceId, Number, Date, NetPriceInBaseCurrency, CustomerRealName
FROM SLS.Invoice
WHERE NetPriceInBaseCurrency = 0 AND FiscalYearRef = $fySubquery
ORDER BY Date DESC
"@
$r2s = Invoke-SqlcmdRemote -Sql $sql2Sample -Label "zero_invoice_sample"
Write-Host "  Sample (TOP 3):" -ForegroundColor Green
Write-Host $r2s
$report += "**Sample rows (TOP 3)**:`n```````n$r2s`n``````n`n"

# ── 3. Duplicate Vouchers ──────────────────────────────────────────────────
Write-Host "`n[3] duplicate_vouchers" -ForegroundColor Yellow
$report += "`n## 3. duplicate_vouchers`n`n"
$report += "**Engine logic**: GROUP BY v.Date, v.Description, HAVING COUNT(*) > 1, v.Type IN (1,2)`n`n"

$sql3Count = @"
SELECT COUNT(*) AS dup_count FROM (
  SELECT v.Date, v.Description, COUNT(*) AS cnt
  FROM ACC.VoucherItem vi
  JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
  WHERE v.Type IN (1, 2) AND v.FiscalYearRef = $fySubquery
  GROUP BY v.Date, v.Description
  HAVING COUNT(*) > 1
) t
"@
$r3c = Invoke-SqlcmdRemote -Sql $sql3Count -Label "dup_count"
Write-Host "  Count: $r3c" -ForegroundColor Green
$report += "**Count**: $r3c`n`n"

$sql3Sample = @"
SELECT TOP 3 v.Date, v.Description, COUNT(*) AS cnt, SUM(vi.Debit) AS TotalDebit
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
WHERE v.Type IN (1, 2) AND v.FiscalYearRef = $fySubquery
GROUP BY v.Date, v.Description
HAVING COUNT(*) > 1
ORDER BY v.Date DESC
"@
$r3s = Invoke-SqlcmdRemote -Sql $sql3Sample -Label "dup_sample"
Write-Host "  Sample (TOP 3):" -ForegroundColor Green
Write-Host $r3s
$report += "**Sample rows (TOP 3)**:`n```````n$r3s`n``````n`n"

# ── 4. Vouchers Without Account ────────────────────────────────────────────
Write-Host "`n[4] vouchers_without_account" -ForegroundColor Yellow
$report += "`n## 4. vouchers_without_account`n`n"
$report += "**Engine logic**: WHERE vi.AccountSLRef IS NULL OR vi.AccountSLRef = 0`n`n"

$sql4Count = @"
SELECT COUNT(*) AS no_account_count
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
WHERE (vi.AccountSLRef IS NULL OR vi.AccountSLRef = 0) AND v.FiscalYearRef = $fySubquery
"@
$r4c = Invoke-SqlcmdRemote -Sql $sql4Count -Label "no_account_count"
Write-Host "  Count: $r4c" -ForegroundColor Green
$report += "**Count**: $r4c`n`n"

$sql4Sample = @"
SELECT TOP 3 vi.VoucherItemId, v.Number, v.Date, vi.Description, vi.Debit, vi.Credit
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
WHERE (vi.AccountSLRef IS NULL OR vi.AccountSLRef = 0) AND v.FiscalYearRef = $fySubquery
ORDER BY v.Date DESC
"@
$r4s = Invoke-SqlcmdRemote -Sql $sql4Sample -Label "no_account_sample"
Write-Host "  Sample (TOP 3):" -ForegroundColor Green
Write-Host $r4s
$report += "**Sample rows (TOP 3)**:`n```````n$r4s`n``````n`n"

# ── Summary ─────────────────────────────────────────────────────────────────
$report += "`n## Summary`n`n"
$report += "| Metric | Count | Sample Rows | Verdict |`n"
$report += "|--------|-------|-------------|---------|`n"
$report += "| unbalanced_vouchers | $($r1c -replace '.*?(\d+).*','$1') | TOP 3 | Needs accountant review |`n"
$report += "| zero_amount_invoices | $($r2c -replace '.*?(\d+).*','$1') | TOP 3 | Needs accountant review |`n"
$report += "| duplicate_vouchers | $($r3c -replace '.*?(\d+).*','$1') | TOP 3 | Needs accountant review |`n"
$report += "| vouchers_without_account | $($r4c -replace '.*?(\d+).*','$1') | TOP 3 | Needs accountant review |`n"

$report | Set-Content -Path $outputFile -Encoding UTF8
Write-Host "`n  Report saved to: $outputFile" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
