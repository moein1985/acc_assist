$ErrorActionPreference = 'Stop'
$fy = '1402'

function Run-Sql {
  param([string]$Sql, [string]$Label)
  Write-Output "[$Label] executing..."
  $tempFile = [System.IO.Path]::GetTempFileName() + ".sql"
  $Sql | Set-Content -Path $tempFile -Encoding Unicode
  try {
    $output = & sqlcmd -S 127.0.0.1,58033 -U damavand -P damavand -d Sepidar01 -i $tempFile -W -s "|" -h -1 2>&1
    $outputStr = ($output | Out-String).Trim()
    if ($outputStr) {
      Write-Output ("RESULT:" + $outputStr)
    } else {
      Write-Output "RESULT:NULL"
    }
  } catch {
    Write-Output ("ERROR:" + $_.Exception.Message)
  } finally {
    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Output "=== GROUND-TRUTH PROBE START ==="
Write-Output "FiscalYear: $fy"
Write-Output ""

Write-Output "--- Part 1: 6 Core Metrics ---"

Run-Sql "SELECT SUM(NetPriceInBaseCurrency) AS Column1 FROM SLS.Invoice WHERE FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "net_sales"

Run-Sql "SELECT SUM(vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "trial_balance"

Run-Sql "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "account_balance"

Run-Sql "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Code LIKE '05%' AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "total_expenses"

Run-Sql "SELECT (SELECT ISNULL(SUM(Balance), 0) FROM RPA.CashBalance) + (SELECT ISNULL(SUM(Balance), 0) FROM RPA.BankAccountBalance) AS Column1" "cash_bank_balance"

Run-Sql "SELECT SUM(vi.Debit - vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND a.Code LIKE '02%' AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "receivables"

Write-Output ""
Write-Output "--- Part 2: Trial Balance A/B/C ---"

Run-Sql "SELECT SUM(vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "trial_balance_A_debit"

Run-Sql "SELECT SUM(vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "trial_balance_B_debit_all"

Run-Sql "SELECT SUM(vi.Credit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "trial_balance_C_credit"

Run-Sql "SELECT SUM(vi.Debit) AS Column1 FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$fy')" "trial_balance_B_credit_all"

Write-Output ""
Write-Output "=== GROUND-TRUTH PROBE END ==="
