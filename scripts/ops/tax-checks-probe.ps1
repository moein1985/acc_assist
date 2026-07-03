<#
.SYNOPSIS
  Phase 30 — Tax & Checks Probe: verify VAT rates, tax metrics, and check sampling.
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
$outputFile = "scripts\ops\tax-checks-probe-$dateStr.md"

Write-Host '===================================================================' -ForegroundColor Cyan
Write-Host "  TAX & CHECKS PROBE — Phase 30" -ForegroundColor Cyan
Write-Host "  Server: $SshHost`:$SshPort → SQL 127.0.0.1:58033 ($SqlDatabase)" -ForegroundColor Cyan
Write-Host "  Fiscal Year: $FiscalYear" -ForegroundColor Cyan
Write-Host '===================================================================' -ForegroundColor Cyan

$report = @"
# Tax & Checks Probe Report — $dateStr

## Phase 30: VAT Rate Verification + Tax/Check Metric Sampling

Fiscal Year: $FiscalYear
Server: $SshHost`:$SshPort → SQL 127.0.0.1:58033 ($SqlDatabase)

"@

# ── 1. VAT Rate Analysis ───────────────────────────────────────────────────
Write-Host "`n[1] VAT rate analysis" -ForegroundColor Yellow
$report += "`n## 1. VAT Rate Analysis`n`n"
$report += "**Engine logic**: vat_detailed uses CASE WHEN VatAmount > 0 THEN 'standard' ELSE 'exempt'`n`n"

$sqlVatRate = @"
SELECT
  CASE WHEN inv.VatAmount > 0 THEN 'standard' ELSE 'exempt' END AS rate_category,
  COUNT(*) AS invoice_count,
  ISNULL(SUM(inv.NetPriceInBaseCurrency), 0) AS net_total,
  ISNULL(SUM(inv.TaxInBaseCurrency), 0) AS tax_total,
  CASE WHEN SUM(inv.NetPriceInBaseCurrency) > 0
    THEN CAST(SUM(inv.TaxInBaseCurrency) AS FLOAT) / SUM(inv.NetPriceInBaseCurrency) * 100
    ELSE 0 END AS effective_rate_pct
FROM SLS.Invoice inv
WHERE inv.FiscalYearRef = $fySubquery
GROUP BY CASE WHEN inv.VatAmount > 0 THEN 'standard' ELSE 'exempt' END
ORDER BY rate_category
"@
$r1 = Invoke-SqlcmdRemote -Sql $sqlVatRate -Label "vat_rate"
Write-Host $r1
$report += "**VAT breakdown**:`n```````n$r1`n``````n`n"
$report += "**Expected**: standard rate ~9% (Iran VAT), exempt = 0%`n`n"

# ── 2. Tax Monthly Summary ─────────────────────────────────────────────────
Write-Host "`n[2] tax_monthly_summary" -ForegroundColor Yellow
$report += "`n## 2. tax_monthly_summary`n`n"

$sqlTaxMonthly = @"
SELECT MONTH(inv.IssueDate) AS month_num,
  ISNULL(SUM(inv.TaxInBaseCurrency), 0) AS tax_total,
  COUNT(*) AS invoice_count
FROM SLS.Invoice inv
WHERE inv.FiscalYearRef = $fySubquery
GROUP BY MONTH(inv.IssueDate)
ORDER BY month_num
"@
$r2 = Invoke-SqlcmdRemote -Sql $sqlTaxMonthly -Label "tax_monthly"
Write-Host $r2
$report += "**Monthly tax breakdown**:`n```````n$r2`n``````n`n"

# ── 3. Invoices Without Tax ────────────────────────────────────────────────
Write-Host "`n[3] invoices_without_tax" -ForegroundColor Yellow
$report += "`n## 3. invoices_without_tax`n`n"

$sqlNoTaxCount = @"
SELECT COUNT(*) AS no_tax_count
FROM SLS.Invoice
WHERE (TaxInBaseCurrency = 0 OR TaxInBaseCurrency IS NULL) AND FiscalYearRef = $fySubquery
"@
$r3c = Invoke-SqlcmdRemote -Sql $sqlNoTaxCount -Label "no_tax_count"
Write-Host "  Count: $r3c" -ForegroundColor Green
$report += "**Count**: $r3c`n`n"

$sqlNoTaxSample = @"
SELECT TOP 3 InvoiceId, Number, Date, CustomerRealName, NetPriceInBaseCurrency, TaxInBaseCurrency
FROM SLS.Invoice
WHERE (TaxInBaseCurrency = 0 OR TaxInBaseCurrency IS NULL) AND FiscalYearRef = $fySubquery
ORDER BY Date DESC
"@
$r3s = Invoke-SqlcmdRemote -Sql $sqlNoTaxSample -Label "no_tax_sample"
Write-Host $r3s
$report += "**Sample (TOP 3)**:`n```````n$r3s`n``````n`n"

# ── 4. VAT Liability ───────────────────────────────────────────────────────
Write-Host "`n[4] vat_liability" -ForegroundColor Yellow
$report += "`n## 4. vat_liability`n`n"

$sqlVatLiab = @"
SELECT ISNULL(SUM(inv.TaxInBaseCurrency), 0) AS total_output_vat
FROM SLS.Invoice inv
WHERE inv.FiscalYearRef = $fySubquery
"@
$r4 = Invoke-SqlcmdRemote -Sql $sqlVatLiab -Label "vat_liability"
Write-Host "  Total output VAT: $r4" -ForegroundColor Green
$report += "**Total output VAT (from invoices)**:`n```````n$r4`n``````n`n"

# ── 5. Tax Liability Summary (from ledger) ─────────────────────────────────
Write-Host "`n[5] tax_liability_summary (ledger)" -ForegroundColor Yellow
$report += "`n## 5. tax_liability_summary (from ledger)`n`n"

$sqlTaxLedger = @"
SELECT ISNULL(SUM(vi.Credit - vi.Debit), 0) AS tax_ledger_balance
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery
  AND a.Title LIKE N'%مالیات%'
  AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('21','22')))
"@
$r5 = Invoke-SqlcmdRemote -Sql $sqlTaxLedger -Label "tax_ledger"
Write-Host "  Tax ledger balance: $r5" -ForegroundColor Green
$report += "**Tax ledger balance (Credit-Debit)**:`n```````n$r5`n``````n`n"
$report += "**Note**: Output VAT (invoices) vs ledger tax balance — reconciliation needed by accountant`n`n"

# ── 6. Checks Due ──────────────────────────────────────────────────────────
Write-Host "`n[6] checks_due" -ForegroundColor Yellow
$report += "`n## 6. checks_due`n`n"
$report += "**Engine logic**: RPA.ReceiptCheque UNION RPA.PaymentCheque, Status=1 (in-process)`n`n"

$sqlChecksDue = @"
SELECT COUNT(*) AS due_count, ISNULL(SUM(Amount),0) AS due_total FROM (
  SELECT ReceiptChequeId AS CheckId, Amount, State FROM RPA.ReceiptCheque WHERE State = 1
  UNION ALL
  SELECT PaymentChequeId, Amount, State FROM RPA.PaymentCheque WHERE State = 1
) t
"@
$r6c = Invoke-SqlcmdRemote -Sql $sqlChecksDue -Label "checks_due_count"
Write-Host "  Count/Total: $r6c" -ForegroundColor Green
$report += "**Count + Total (Status=1)**:`n```````n$r6c`n``````n`n"

$sqlChecksDueSample = @"
SELECT TOP 3 * FROM (
  SELECT 'receipt' AS direction, ReceiptChequeId AS CheckId, Number, Date AS DueDate, Amount, State
  FROM RPA.ReceiptCheque WHERE State = 1
  UNION ALL
  SELECT 'payment', PaymentChequeId, Number, Date, Amount, State
  FROM RPA.PaymentCheque WHERE State = 1
) t ORDER BY DueDate DESC
"@
$r6s = Invoke-SqlcmdRemote -Sql $sqlChecksDueSample -Label "checks_due_sample"
Write-Host $r6s
$report += "**Sample (TOP 3)**:`n```````n$r6s`n``````n`n"

# ── 7. Checks Bounced ──────────────────────────────────────────────────────
Write-Host "`n[7] checks_bounced" -ForegroundColor Yellow
$report += "`n## 7. checks_bounced`n`n"

$sqlChecksBounced = @"
SELECT COUNT(*) AS bounced_count, ISNULL(SUM(Amount),0) AS bounced_total FROM (
  SELECT ReceiptChequeId AS CheckId, Amount, State FROM RPA.ReceiptCheque WHERE State = 2
  UNION ALL
  SELECT PaymentChequeId, Amount, State FROM RPA.PaymentCheque WHERE State = 2
) t
"@
$r7c = Invoke-SqlcmdRemote -Sql $sqlChecksBounced -Label "checks_bounced_count"
Write-Host "  Count/Total: $r7c" -ForegroundColor Green
$report += "**Count + Total (Status=2)**:`n```````n$r7c`n``````n`n"

$sqlChecksBouncedSample = @"
SELECT TOP 3 * FROM (
  SELECT 'receipt' AS direction, ReceiptChequeId AS CheckId, Number, Date AS DueDate, Amount, State
  FROM RPA.ReceiptCheque WHERE State = 2
  UNION ALL
  SELECT 'payment', PaymentChequeId, Number, Date, Amount, State
  FROM RPA.PaymentCheque WHERE State = 2
) t ORDER BY DueDate DESC
"@
$r7s = Invoke-SqlcmdRemote -Sql $sqlChecksBouncedSample -Label "checks_bounced_sample"
Write-Host $r7s
$report += "**Sample (TOP 3)**:`n```````n$r7s`n``````n`n"

# ── 8. Checks Summary ──────────────────────────────────────────────────────
Write-Host "`n[8] checks_summary" -ForegroundColor Yellow
$report += "`n## 8. checks_summary`n`n"

$sqlChecksSummary = @"
SELECT State, COUNT(*) AS cnt, ISNULL(SUM(Amount),0) AS total FROM (
  SELECT Amount, State FROM RPA.ReceiptCheque
  UNION ALL
  SELECT Amount, State FROM RPA.PaymentCheque
) t GROUP BY State ORDER BY State
"@
$r8 = Invoke-SqlcmdRemote -Sql $sqlChecksSummary -Label "checks_summary"
Write-Host $r8
$report += "**Summary by state**:`n```````n$r8`n``````n`n"
$report += "**States**: 1=in-process, 2=bounced, others as defined in Sepidar`n"

$report | Set-Content -Path $outputFile -Encoding UTF8
Write-Host "`n  Report saved to: $outputFile" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
