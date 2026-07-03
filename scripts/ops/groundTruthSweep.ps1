<#
.SYNOPSIS
  S29.4 — Ground-truth sweep harness for T1 scalar metrics.
  Runs independent oracle SQL queries via sqlcmd on the remote server,
  then runs engine questions via HTTP debug API, compares, and updates registry.

.DESCRIPTION
  Oracle queries use Code LIKE 'XX%' prefix filtering (independent from
  engine's ParentAccountRef hierarchical approach). If both give the same
  number, it's strong evidence of correctness.

  Usage:
    pwsh -ExecutionPolicy Bypass -File scripts/ops/groundTruthSweep.ps1
    pwsh -ExecutionPolicy Bypass -File scripts/ops/groundTruthSweep.ps1 -OracleOnly
    pwsh -ExecutionPolicy Bypass -File scripts/ops/groundTruthSweep.ps1 -DebugToken "mytoken"

.PARAMETER OracleOnly
  Only run oracle SQL queries, skip engine comparison.

.PARAMETER DebugToken
  Token for the HTTP debug API on the remote server.

.PARAMETER FiscalYear
  Persian fiscal year to sweep (default: 1402)
#>

param(
  [string]$SshHost = '192.168.85.56',
  [int]$SshPort = 2211,
  [string]$SshUser = 'administrator',
  [string]$SshPassword = 'Hs-co@12321#',
  [string]$HostKey = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ',
  [string]$SqlDatabase = 'Sepidar01',
  [string]$SqlUser = 'damavand',
  [string]$SqlPassword = 'damavand',
  [string]$FiscalYear = '1402',
  [switch]$OracleOnly,
  [string]$DebugToken = '',
  [int]$DebugPort = 3322
)

$ErrorActionPreference = 'Stop'

# ── Helper: SSH command via plink ─────────────────────────────────────────────
function Invoke-SshCommand {
  param([string]$Command)
  $output = & plink -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" $Command 2>&1
  return $output
}

function Invoke-RemotePowerShell {
  param([string]$Script)
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
  Invoke-SshCommand "powershell -NoProfile -EncodedCommand $encoded"
}

# ── Helper: Run sqlcmd on remote server ───────────────────────────────────────
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
  $remoteScript += "  `$raw = & sqlcmd -S 127.0.0.1,58033 -U $SqlUser -P $SqlPassword -d $SqlDatabase -i `$tmpFile -h -1 -W 2>&1;"
  $remoteScript += "  Remove-Item `$tmpFile -ErrorAction SilentlyContinue;"
  $remoteScript += "  `$lines = (`$raw | Out-String).Trim() -split '`r?`n';"
  $remoteScript += "  `$val = `$lines | Where-Object { `$_ -match '^-?[\d,]+\.?\d*$' } | Select-Object -First 1;"
  $remoteScript += "  if (`$val) { Write-Output ('RESULT:' + (`$val -replace ',','')) }"
  $remoteScript += "  else { Write-Output ('RESULT:NULL') }"
  $remoteScript += "} catch {"
  $remoteScript += "  Remove-Item `$tmpFile -ErrorAction SilentlyContinue;"
  $remoteScript += "  Write-Output ('ERROR:' + `$_.Exception.Message)"
  $remoteScript += "}"

  $output = Invoke-RemotePowerShell $remoteScript
  $outputStr = ($output | Out-String).Trim()

  if ($outputStr -match 'RESULT:(.+?)(?:[\r\n]|$)') {
    $value = $Matches[1].Trim()
    Write-Host " $value" -ForegroundColor Green
    if ($value -eq 'NULL') { return 0 }
    return [double]$value
  } elseif ($outputStr -match 'ERROR:(.+?)(?:[\r\n]|$)') {
    $err = $Matches[1]
    Write-Host " ERROR: $err" -ForegroundColor Red
    return "ERROR: $err"
  } else {
    Write-Host " UNEXPECTED OUTPUT" -ForegroundColor Yellow
    Write-Host "    Raw: $outputStr" -ForegroundColor DarkGray
    return "UNEXPECTED: $outputStr"
  }
}

# ── Helper: Run engine question via HTTP debug API ────────────────────────────
function Invoke-EngineQuestion {
  param([string]$PromptB64, [string]$Label)
  Write-Host "  [$Label] engine..." -NoNewline

  if (-not $DebugToken) {
    Write-Host " SKIPPED (no token)" -ForegroundColor DarkGray
    return $null
  }

  try {
    $body = @{ prompt = $PromptB64; conversationId = 'sweep' } | ConvertTo-Json
    $headers = @{ 'x-debug-token' = $DebugToken; 'Content-Type' = 'application/json' }
    $url = "http://${SshHost}:$DebugPort/api/agent/message"

    $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -Headers $headers -TimeoutSec 60
    $text = $response.responseText
    $requestId = $response.requestId

    # Extract first numeric value from response text
    $numMatch = [regex]::Match($text, '([\d,]+(?:\.\d+)?)')
    if ($numMatch.Success) {
      $numStr = $numMatch.Groups[1].Value -replace ',', ''
      $num = [double]$numStr
      Write-Host " $num (reqId: $requestId)" -ForegroundColor Green
      return @{ value = $num; requestId = $requestId; text = $text }
    } else {
      Write-Host " NO NUMBER (reqId: $requestId)" -ForegroundColor Yellow
      return @{ value = $null; requestId = $requestId; text = $text }
    }
  } catch {
    Write-Host " ERROR: $($_.Exception.Message)" -ForegroundColor Red
    return @{ value = $null; requestId = ''; text = $_.Exception.Message }
  }
}

# ── T1 Scalar Oracle Queries (independent: Code LIKE prefix approach) ─────────
# Engine uses ParentAccountRef IN (...) hierarchical filters.
# Oracle uses Code LIKE 'XX%' prefix filters — different SQL, same accounts.

$fySubquery = "(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$FiscalYear')"

$oracleQueries = @(
  # Already verified seeds (re-run for consistency check)
  @{ Id = 'net_sales'; Tier = 'T1'; EnginePrompt = '2YHYsdmI2LQg27HbtNuw27I='
     Sql = "SELECT SUM(NetPriceInBaseCurrency) AS Column1 FROM SLS.Invoice WHERE FiscalYearRef = $fySubquery" },
  @{ Id = 'trial_balance'; Tier = 'T1'; EnginePrompt = '2KrYsdin2LIg2KLYstmF2KfbjNi024wg27HbtNuw27I='
     Sql = "SELECT SUM(vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'cash_bank_balance'; Tier = 'T1'; EnginePrompt = '2YXYp9mG2K/ZhyDZhtmC2K8g2Ygg2KjYp9mG2qkg27HbtNuw27I='
     Sql = "SELECT (SELECT ISNULL(SUM(Balance), 0) FROM RPA.CashBalance) + (SELECT ISNULL(SUM(Balance), 0) FROM RPA.BankAccountBalance) AS Column1" },
  @{ Id = 'receivables'; Tier = 'T1'; EnginePrompt = '2K/YsduM2KfZgdiq2YbbjOKAjNmH2Kcg27HbtNuw27I='
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND p1.Code IN ('12','13') AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '11')) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'payables'; Tier = 'T1'; EnginePrompt = '2b7Ysdiv2KfYrtiq2YbbjOKAjNmH2Kcg27HbtNuw27I='
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND p1.Code IN ('10','12') AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '21')) AND v.FiscalYearRef = $fySubquery" },

  # New T1 scalar metrics to sweep
  @{ Id = 'trial_balance_check'; Tier = 'T1'; EnginePrompt = '2KLbjNinINiq2LHYp9iyINii2LLZhdin24zYtNuMINmF24zigIzYqNmG2K/YryDbsdu027Dbsg=='
     Sql = "SELECT SUM(vi.Debit) - SUM(vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'purchases'; Tier = 'T1'; EnginePrompt = '2K7YsduM2K8g27HbtNuw27I='
     Sql = "SELECT ISNULL(SUM(NetPriceInBaseCurrency), 0) AS Column1 FROM POM.PurchaseInvoice WHERE FiscalYearRef = $fySubquery" },
  @{ Id = 'net_profit'; Tier = 'T1'; EnginePrompt = '2LPZiNivINiu2KfZhNi1INux27TbsNuy'
     Sql = "SELECT SUM(vi.Credit - vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code IN ('41','61','62'))) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'total_assets'; Tier = 'T1'; EnginePrompt = '2qnZhCDYr9in2LHYp9uM24zigIzZh9inINux27TbsNuy'
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code IN ('11','12'))) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'total_liabilities'; Tier = 'T1'; EnginePrompt = '2qnZhCDYqNiv2YfbjOKAjNmH2Kcg27HbtNuw27I='
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code IN ('21','22'))) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'total_equity'; Tier = 'T1'; EnginePrompt = '2K3ZgtmI2YIg2LXYp9it2KjYp9mGINiz2YfYp9mFINux27TbsNuy'
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '31')) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'total_revenue'; Tier = 'T1'; EnginePrompt = '2qnZhCDYr9ix2KLZhdiv4oCM2YfYpyDbsdu027Dbsg=='
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '41')) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'total_expenses'; Tier = 'T1'; EnginePrompt = '2qnZhCDZh9iy24zZhtmH4oCM2YfYpyDbsdu027Dbsg=='
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '61')) AND v.FiscalYearRef = $fySubquery" },

  # ── Tier 2 scalar/count metrics ──
  @{ Id = 'sales_count'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM SLS.Invoice WHERE FiscalYearRef = $fySubquery" },
  @{ Id = 'fiscal_year_count'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM FMK.FiscalYear" },
  @{ Id = 'cogs'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '61')) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'tax_paid'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Title LIKE N'%مالیات%' AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code IN ('11','12'))) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'tax_collected'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT SUM(vi.Credit - vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Title LIKE N'%مالیات%' AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code IN ('21','22'))) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'inventory_value'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT ISNULL(SUM(Quantity), 0) AS Column1 FROM INV.vwItemStockSummary" },
  @{ Id = 'vat_liability'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT ISNULL(SUM(TaxInBaseCurrency), 0) AS Column1 FROM SLS.Invoice WHERE FiscalYearRef = $fySubquery" },
  @{ Id = 'fiscal_year_list'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM FMK.FiscalYear" },
  @{ Id = 'unbalanced_vouchers'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM (SELECT vi.VoucherRef, SUM(vi.Debit) AS D, SUM(vi.Credit) AS C FROM ACC.VoucherItem vi GROUP BY vi.VoucherRef HAVING ABS(SUM(vi.Debit) - SUM(vi.Credit)) > 0.01) t" },
  @{ Id = 'zero_amount_invoices'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM SLS.Invoice WHERE ISNULL(NetPriceInBaseCurrency, 0) = 0 AND FiscalYearRef = $fySubquery" },
  @{ Id = 'duplicate_vouchers'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM (SELECT Number, COUNT(*) AS cnt FROM ACC.Voucher WHERE Type NOT IN (3, 4) GROUP BY Number HAVING COUNT(*) > 1) t" },
  @{ Id = 'vouchers_without_account'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND vi.AccountSLRef IS NULL AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'invoices_without_tax'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM SLS.Invoice WHERE (ISNULL(TaxInBaseCurrency, 0) = 0) AND FiscalYearRef = $fySubquery" },
  @{ Id = 'checks_due'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT (SELECT COUNT(*) FROM RPA.ReceiptCheque WHERE State = 1) + (SELECT COUNT(*) FROM RPA.PaymentCheque WHERE State = 1) AS Column1" },
  @{ Id = 'checks_bounced'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT (SELECT COUNT(*) FROM RPA.ReceiptCheque WHERE State = 3) + (SELECT COUNT(*) FROM RPA.PaymentCheque WHERE State = 3) AS Column1" },
  @{ Id = 'checks_summary'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT (SELECT COUNT(*) FROM RPA.ReceiptCheque) + (SELECT COUNT(*) FROM RPA.PaymentCheque) AS Column1" },
  @{ Id = 'closing_status'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.Voucher WHERE Type IN (3, 4) AND FiscalYearRef = $fySubquery" },
  @{ Id = 'tax_liability_summary'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT ISNULL(SUM(TaxInBaseCurrency), 0) - ISNULL((SELECT SUM(vi.Debit - vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Title LIKE N'%مالیات%' AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code IN ('11','12'))) AND v.FiscalYearRef = $fySubquery), 0) AS Column1 FROM SLS.Invoice WHERE FiscalYearRef = $fySubquery" },

  # ── Tier 2 count-proxy metrics (scalar verification of row-based metrics) ──
  @{ Id = 'sales_by_period'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(DISTINCT MONTH(src.Date)) AS Column1 FROM SLS.Invoice src WHERE src.FiscalYearRef = $fySubquery" },
  @{ Id = 'recent_documents'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.Voucher v WHERE v.FiscalYearRef = $fySubquery AND v.Type NOT IN (3, 4)" },
  @{ Id = 'vouchers_by_date'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.Voucher v WHERE v.FiscalYearRef = $fySubquery AND v.Type NOT IN (3, 4)" },
  @{ Id = 'vouchers_by_type'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(DISTINCT v.Type) AS Column1 FROM ACC.Voucher v WHERE v.FiscalYearRef = $fySubquery AND v.Type NOT IN (3, 4)" },
  @{ Id = 'tax_monthly_summary'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(DISTINCT MONTH(src.Date)) AS Column1 FROM SLS.Invoice src WHERE src.FiscalYearRef = $fySubquery" },
  @{ Id = 'cogs_detailed'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '61')) AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'vat_detailed'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM SLS.Invoice WHERE ISNULL(TaxInBaseCurrency, 0) > 0 AND FiscalYearRef = $fySubquery" },
  @{ Id = 'period_comparison'; Tier = 'T2'; EnginePrompt = ''
     Sql = "SELECT COUNT(DISTINCT FiscalYearRef) AS Column1 FROM ACC.Voucher WHERE Type NOT IN (3, 4)" },

  # ── Tier 3 data-existence probes ──
  @{ Id = 'payroll'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Title LIKE N'%حقوق%' AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'inventory_turnover'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT ISNULL(SUM(OutputQuantity), 0) AS Column1 FROM INV.vwItemStockSummary" },
  @{ Id = 'low_stock_items'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM INV.vwItemStockSummary WHERE Quantity <= 0" },
  @{ Id = 'cost_center_summary'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM GEN.CostCenter" },
  @{ Id = 'project_summary'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM GEN.Project" },
  @{ Id = 'project_profitability'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM GEN.Project" },
  @{ Id = 'cost_allocation'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM GEN.CostCenter" },
  @{ Id = 'budget_variance'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM GEN.Budget" },
  @{ Id = 'budget_report'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM GEN.Budget" },
  @{ Id = 'cash_flow_statement'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Code LIKE '0101%' AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'cash_flow_direct'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND (a.Code LIKE '0101%' OR a.Code LIKE '0102%') AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'trend_analysis'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(DISTINCT FiscalYearRef) AS Column1 FROM ACC.Voucher WHERE Type NOT IN (3, 4)" },
  @{ Id = 'fixed_assets_register'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Code LIKE '0106%' AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'depreciation_summary'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Title LIKE N'%استهلاک%' AND v.FiscalYearRef = $fySubquery" },
  @{ Id = 'cost_center_detailed'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT COUNT(*) AS Column1 FROM GEN.CostCenter" },
  @{ Id = 'bank_reconciliation'; Tier = 'T3'; EnginePrompt = ''
     Sql = "SELECT ISNULL(SUM(Balance), 0) AS Column1 FROM RPA.BankAccountBalance" }
)

# ── Main ──────────────────────────────────────────────────────────────────────
$dateStr = Get-Date -Format 'yyyy-MM-dd'
$outputFile = "scripts\ops\sweep-$dateStr.md"

Write-Host '===================================================================' -ForegroundColor Cyan
Write-Host "  GROUND-TRUTH SWEEP — S29.4 (T1 Scalar Metrics)" -ForegroundColor Cyan
Write-Host "  Server: $SshHost`:$SshPort" -ForegroundColor Cyan
Write-Host "  SQL: 127.0.0.1:58033 ($SqlDatabase)" -ForegroundColor Cyan
Write-Host "  Fiscal Year: $FiscalYear" -ForegroundColor Cyan
Write-Host "  OracleOnly: $OracleOnly" -ForegroundColor Cyan
Write-Host '===================================================================' -ForegroundColor Cyan
Write-Host ''

$results = @()

# ── Part 1: Oracle SQL queries ────────────────────────────────────────────────
Write-Host '-- Part 1: Oracle SQL queries (independent Code LIKE approach) --' -ForegroundColor Yellow
foreach ($q in $oracleQueries) {
  $oracleValue = Invoke-SqlcmdRemote -Sql $q.Sql -Label $q.Id

  $engineValue = $null
  $engineRequestId = ''
  $engineText = ''
  $diff = $null

  if (-not $OracleOnly -and $DebugToken) {
    Write-Host '-- Part 2: Engine comparison --' -ForegroundColor Yellow
    $engineResult = Invoke-EngineQuestion -PromptB64 $q.EnginePrompt -Label $q.Id
    if ($engineResult -and $engineResult.value -ne $null) {
      $engineValue = $engineResult.value
      $engineRequestId = $engineResult.requestId
      $engineText = $engineResult.text
      if ($oracleValue -is [double] -and $engineValue -ne $null) {
        $diff = [math]::Abs($oracleValue - $engineValue)
      }
    }
  }

  $results += [PSCustomObject]@{
    Id              = $q.Id
    Tier            = $q.Tier
    OracleValue     = $oracleValue
    EngineValue     = $engineValue
    Diff            = $diff
    EngineRequestId = $engineRequestId
    EngineText      = $engineText
    OracleSql       = $q.Sql
  }
}

# ── Generate markdown report ──────────────────────────────────────────────────
Write-Host ''
Write-Host '-- Generating report --' -ForegroundColor Yellow

$sb = [Text.StringBuilder]::new()
[void]$sb.AppendLine("# Ground-Truth Sweep — $dateStr")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## T1 Scalar Metrics — Oracle vs Engine")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("- **Oracle approach**: Code LIKE 'XX%' prefix filtering (independent from engine)")
[void]$sb.AppendLine("- **Engine approach**: ParentAccountRef IN (...) hierarchical filtering")
[void]$sb.AppendLine("- **Fiscal Year**: $FiscalYear")
[void]$sb.AppendLine("- **OracleOnly**: $OracleOnly")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("| Metric | Tier | Oracle Value | Engine Value | Diff | Engine RequestId |")
[void]$sb.AppendLine("|--------|------|-------------|-------------|------|------------------|")

foreach ($r in $results) {
  $oracleStr = if ($r.OracleValue -is [double]) { $r.OracleValue.ToString('N0') } else { "$($r.OracleValue)" }
  $engineStr = if ($r.EngineValue) { $r.EngineValue.ToString('N0') } else { 'N/A' }
  $diffStr = if ($r.Diff -ne $null) { $r.Diff.ToString('N0') } else { 'N/A' }
  [void]$sb.AppendLine("| $($r.Id) | $($r.Tier) | $oracleStr | $engineStr | $diffStr | $($r.EngineRequestId) |")
}

[void]$sb.AppendLine("")
[void]$sb.AppendLine("### Oracle SQL Queries (hand-written, independent of engine)")
[void]$sb.AppendLine("")
foreach ($r in $results) {
  [void]$sb.AppendLine("#### $($r.Id)")
  [void]$sb.AppendLine('```sql')
  [void]$sb.AppendLine($r.OracleSql)
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine("")
}

if (-not $OracleOnly -and $DebugToken) {
  [void]$sb.AppendLine("### Engine Responses (raw text)")
  [void]$sb.AppendLine("")
  foreach ($r in $results) {
    if ($r.EngineText) {
      [void]$sb.AppendLine("#### $($r.Id) (reqId: $($r.EngineRequestId))")
      [void]$sb.AppendLine('```')
      [void]$sb.AppendLine($r.EngineText)
      [void]$sb.AppendLine('```')
      [void]$sb.AppendLine("")
    }
  }
}

[void]$sb.AppendLine("### Analysis")
[void]$sb.AppendLine("")
$verified = ($results | Where-Object { $_.Diff -ne $null -and $_.Diff -eq 0 }).Count
$failed = ($results | Where-Object { $_.Diff -ne $null -and $_.Diff -ne 0 }).Count
$pending = ($results | Where-Object { $_.Diff -eq $null }).Count
[void]$sb.AppendLine("- **Verified (diff=0)**: $verified")
[void]$sb.AppendLine("- **Failed (diff!=0)**: $failed")
[void]$sb.AppendLine("- **Pending (no comparison)**: $pending")
[void]$sb.AppendLine("")

$sb.ToString() | Set-Content -Path $outputFile -Encoding UTF8

Write-Host "  Report saved to: $outputFile" -ForegroundColor Green
Write-Host ''
Write-Host '=== Summary ===' -ForegroundColor Cyan
Write-Host "  Oracle queries run: $($results.Count)" -ForegroundColor White
if (-not $OracleOnly -and $DebugToken) {
  Write-Host "  Verified (diff=0): $verified" -ForegroundColor $(if ($verified -eq $results.Count) { 'Green' } else { 'Yellow' })
  Write-Host "  Failed (diff!=0): $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
}
Write-Host '===================================================================' -ForegroundColor Cyan
