$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$outFile = "C:\Users\Administrator\account-probe-results.txt"
"" | Set-Content -Path $outFile -Encoding UTF8

function Run-Sql {
  param([string]$Sql, [string]$Label)
  $tempFile = [System.IO.Path]::GetTempFileName() + ".sql"
  $Sql | Set-Content -Path $tempFile -Encoding Unicode
  Add-Content -Path $outFile -Value "`n[$Label]" -Encoding UTF8
  try {
    $output = & sqlcmd -S 127.0.0.1,58033 -U damavand -P damavand -d Sepidar01 -i $tempFile -W -s "|" -u 2>&1
    $outputStr = ($output | Out-String).Trim()
    Add-Content -Path $outFile -Value $outputStr -Encoding UTF8
  } catch {
    Add-Content -Path $outFile -Value ("ERROR:" + $_.Exception.Message) -Encoding UTF8
  } finally {
    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
  }
}

Write-Output "=== HIERARCHY PROBE v5 ==="

Run-Sql "SELECT AccountId, Code, Title, Type, ParentAccountRef FROM ACC.Account WHERE Type = 1 ORDER BY Code" "type1_accounts_with_ids"

Run-Sql "SELECT AccountId, Code, Title, Type, ParentAccountRef FROM ACC.Account WHERE Type = 2 ORDER BY ParentAccountRef, Code" "type2_accounts_with_ids"

Run-Sql "SELECT SUM(vi.Debit - vi.Credit) AS Balance FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1)" "balance_by_type1_parent"

Run-Sql "SELECT p1.AccountId AS Type1Id, p1.Code AS Type1Code, p1.Title AS Type1Title, SUM(vi.Debit - vi.Credit) AS Balance FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId JOIN ACC.Account p2 ON a.ParentAccountRef = p2.AccountId JOIN ACC.Account p1 ON p2.ParentAccountRef = p1.AccountId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') AND p1.Type = 1 GROUP BY p1.AccountId, p1.Code, p1.Title ORDER BY p1.Code" "balance_by_type1_category"

Run-Sql "SELECT p2.AccountId AS Type2Id, p2.Code AS Type2Code, p2.Title AS Type2Title, p1.Code AS Type1Code, SUM(vi.Debit - vi.Credit) AS Balance FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId JOIN ACC.Account p2 ON a.ParentAccountRef = p2.AccountId JOIN ACC.Account p1 ON p2.ParentAccountRef = p1.AccountId WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') AND p1.Type = 1 GROUP BY p2.AccountId, p2.Code, p2.Title, p1.Code ORDER BY p1.Code, p2.Code" "balance_by_type2_category"

Write-Output "Results written to $outFile"
Write-Output "=== END ==="
