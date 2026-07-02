# verify-metric-filters.ps1 — Probe Sepidar DB to verify new hierarchy-based metric filters
# Runs SQL queries using ParentAccountRef hierarchy filters and compares with expected values

$remoteHost = '192.168.85.56'
$sshPort = '2211'
$sshUser = 'administrator'
$sshPass = 'Hs-co@12321#'
$sqlServer = '127.0.0.1,58033'
$sqlDb = 'Sepidar01'
$sqlUser = 'damavand'
$sqlPass = 'damavand'

# SQL query to verify all key metric filters for fiscal year 1402
$sqlScript = @"
SET NOCOUNT ON;
SELECT 'receivables' AS metric,
  SUM(vi.Debit - vi.Credit) AS value
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code IN ('12','13')
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '11')
  )
UNION ALL
SELECT 'payables',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code IN ('10','12')
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '21')
  )
UNION ALL
SELECT 'total_assets',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('11','12'))
  )
UNION ALL
SELECT 'total_liabilities',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('21','22'))
  )
UNION ALL
SELECT 'total_equity',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '31')
  )
UNION ALL
SELECT 'total_revenue',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '41')
  )
UNION ALL
SELECT 'total_expenses',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61')
  )
UNION ALL
SELECT 'balance_sheet',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('11','12','21','22','31'))
  )
UNION ALL
SELECT 'income_statement',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('41','61','62'))
  )
UNION ALL
SELECT 'account_balance_with_slref_filter',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND vi.AccountSLRef IS NOT NULL
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
UNION ALL
SELECT 'account_balance_without_slref_filter',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
UNION ALL
SELECT 'cogs',
  SUM(vi.Debit - vi.Credit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '61')
  )
UNION ALL
SELECT 'net_profit',
  SUM(vi.Credit - vi.Debit)
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4)
  AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = '1402')
  AND a.ParentAccountRef IN (
    SELECT AccountId FROM ACC.Account WHERE Type = 2
    AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code IN ('41','61','62'))
  );
"@

# Write SQL to temp file
$sqlFile = "$env:TEMP\verify-metrics.sql"
$sqlScript | Out-File -FilePath $sqlFile -Encoding UTF8 -NoNewline

# Write the remote PowerShell script
$remoteScript = @"
`$sqlFile = 'C:\Temp\verify-metrics.sql'
`$outFile = 'C:\Temp\verify-metrics-results.txt'

# Execute SQL and write results to UTF-8 file
`$cmd = "sqlcmd -S $sqlServer -d $sqlDb -U $sqlUser -P $sqlPass -i `$sqlFile -s ',' -W"
`$result = Invoke-Expression `$cmd
`$result | Out-File -FilePath `$outFile -Encoding UTF8
Write-Output "DONE"
"@

$remotePsFile = "$env:TEMP\verify-metrics-remote.ps1"
$remoteScript | Out-File -FilePath $remotePsFile -Encoding UTF8 -NoNewline

Write-Host "Copying SQL and script to remote server..."
# Copy files to remote
$pscpArgs = "-P $sshPort -pw $sshPass `"$sqlFile`" `"$remotePsFile`" ${sshUser}@${remoteHost}:C:/Temp/"
Invoke-Expression "pscp $pscpArgs" 2>&1 | Out-Null

Write-Host "Executing verification probe on remote server..."
# Execute remote script
$plinkArgs = "-batch -P $sshPort -pw $sshPass ${sshUser}@${remoteHost} powershell -ExecutionPolicy Bypass -File C:/Temp/verify-metrics-remote.ps1"
$result = Invoke-Expression "plink $plinkArgs 2>&1"

Write-Host "Remote execution result: $result"

# Copy results back
Write-Host "Copying results back..."
$pscpArgs2 = "-P $sshPort -pw $sshPass ${sshUser}@${remoteHost}:C:/Temp/verify-metrics-results.txt `"$env:TEMP\verify-metrics-results.txt`""
Invoke-Expression "pscp $pscpArgs2" 2>&1 | Out-Null

# Display results
$resultsFile = "$env:TEMP\verify-metrics-results.txt"
if (Test-Path $resultsFile) {
    Write-Host "`n=== Verification Results (Fiscal Year 1402) ===" -ForegroundColor Cyan
    Get-Content $resultsFile | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "ERROR: Results file not found!" -ForegroundColor Red
}
