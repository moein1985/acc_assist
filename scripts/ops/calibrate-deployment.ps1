<#
.SYNOPSIS
  Per-deployment calibration script for chart of accounts mapping (Phase 32)

.DESCRIPTION
  Connects to a Sepidar SQL Server database, discovers the chart of accounts
  structure, generates a ChartOfAccountsMapping JSON file, and validates
  balance checks (accounting equation + debit=credit).

.PARAMETER Server
  SQL Server address (default: 127.0.0.1)

.PARAMETER Port
  SQL Server port (default: 58033)

.PARAMETER Database
  Database name (default: Sepidar01)

.PARAMETER User
  SQL user (default: damavand)

.PARAMETER Password
  SQL password (default: damavand)

.PARAMETER OutputPath
  Path to write the calibration JSON file (default: ./calibration-output.json)

.EXAMPLE
  .\calibrate-deployment.ps1 -Server 127.0.0.1 -Port 58033 -Database Sepidar01
#>

param(
  [string]$Server = '127.0.0.1',
  [int]$Port = 58033,
  [string]$Database = 'Sepidar01',
  [string]$User = 'damavand',
  [string]$Password = 'damavand',
  [string]$OutputPath = './calibration-output.json'
)

$ErrorActionPreference = 'Stop'

Write-Host "=== Phase 32: Per-Deployment Calibration ===" -ForegroundColor Cyan
Write-Host "Server: $Server:$Port" -ForegroundColor Gray
Write-Host "Database: $Database" -ForegroundColor Gray
Write-Host ""

# Build connection string
$connString = "Server=$Server,$Port;Database=$Database;User Id=$User;Password=$Password;TrustServerCertificate=True;Encrypt=False"

# ─── Step 1: Discover Type 1 accounts ────────────────────────────────────────
Write-Host "[1/5] Discovering Type 1 (root) accounts..." -ForegroundColor Yellow

$type1Query = "SELECT Code, Title FROM ACC.Account WHERE Type = 1 ORDER BY Code"
$type1Rows = @()

try {
  $conn = New-Object System.Data.SqlClient.SqlConnection($connString)
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $type1Query
  $reader = $cmd.ExecuteReader()
  while ($reader.Read()) {
    $type1Rows += [PSCustomObject]@{ Code = $reader['Code'].ToString(); Title = $reader['Title'].ToString() }
  }
  $reader.Close()
  $conn.Close()
} catch {
  Write-Host "ERROR: Failed to query Type 1 accounts: $_" -ForegroundColor Red
  exit 1
}

Write-Host "  Found $($type1Rows.Count) Type 1 accounts:" -ForegroundColor Green
foreach ($row in $type1Rows) {
  Write-Host "    Code=$($row.Code)  Title=$($row.Title)" -ForegroundColor Gray
}
Write-Host ""

# ─── Step 2: Discover Type 2 accounts ────────────────────────────────────────
Write-Host "[2/5] Discovering Type 2 (sub-category) accounts..." -ForegroundColor Yellow

$type2Query = "SELECT Code, Title, ParentAccountRef FROM ACC.Account WHERE Type = 2 ORDER BY Code"
$type2Rows = @()

try {
  $conn = New-Object System.Data.SqlClient.SqlConnection($connString)
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $type2Query
  $reader = $cmd.ExecuteReader()
  while ($reader.Read()) {
    $type2Rows += [PSCustomObject]@{
      Code = $reader['Code'].ToString()
      Title = $reader['Title'].ToString()
      ParentAccountRef = $reader['ParentAccountRef'].ToString()
    }
  }
  $reader.Close()
  $conn.Close()
} catch {
  Write-Host "ERROR: Failed to query Type 2 accounts: $_" -ForegroundColor Red
  exit 1
}

Write-Host "  Found $($type2Rows.Count) Type 2 accounts" -ForegroundColor Green
Write-Host ""

# ─── Step 3: Build mapping ───────────────────────────────────────────────────
Write-Host "[3/5] Building chart of accounts mapping..." -ForegroundColor Yellow

$standardCodes = @('11','12','21','22','31','41','61')
$matchedCodes = @()
foreach ($code in $standardCodes) {
  if ($type1Rows.Code -contains $code) {
    $matchedCodes += $code
  }
}

$confidence = if ($matchedCodes.Count -ge 6) { 'high' } elseif ($matchedCodes.Count -ge 4) { 'medium' } else { 'low' }

Write-Host "  Standard codes matched: $($matchedCodes.Count)/$($standardCodes.Count)" -ForegroundColor $(if ($matchedCodes.Count -ge 6) { 'Green' } else { 'Yellow' })
Write-Host "  Confidence: $confidence" -ForegroundColor $(if ($confidence -eq 'high') { 'Green' } elseif ($confidence -eq 'medium') { 'Yellow' } else { 'Red' })
Write-Host ""

# Build the mapping JSON
$mapping = [PSCustomObject]@{
  softwareId = 'sepidar'
  databaseName = $Database
  discoveryMethod = 'auto'
  confidence = $confidence
  discoveredAt = (Get-Date).ToString('o')
  concepts = [PSCustomObject]@{
    assets = [PSCustomObject]@{ type1Codes = @('11','12') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '11' -or $type1Rows.Code -contains '12'); description = 'کل دارایی‌ها' }
    current_assets = [PSCustomObject]@{ type1Codes = @('11') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '11'); description = 'دارایی‌های جاری' }
    fixed_assets_concept = [PSCustomObject]@{ type1Codes = @('12') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '12'); description = 'دارایی‌های ثابت' }
    liabilities = [PSCustomObject]@{ type1Codes = @('21','22') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '21' -or $type1Rows.Code -contains '22'); description = 'کل بدهی‌ها' }
    current_liabilities = [PSCustomObject]@{ type1Codes = @('21') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '21'); description = 'بدهی‌های جاری' }
    equity = [PSCustomObject]@{ type1Codes = @('31') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '31'); description = 'حقوق صاحبان سهام' }
    revenue = [PSCustomObject]@{ type1Codes = @('41') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '41'); description = 'درآمدها' }
    expenses = [PSCustomObject]@{ type1Codes = @('61') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '61'); description = 'هزینه‌ها' }
    receivables = [PSCustomObject]@{ type1Codes = @('11'); type2Codes = @('12','13'); available = ($type1Rows.Code -contains '11'); description = 'حساب‌های دریافتنی' }
    payables = [PSCustomObject]@{ type1Codes = @('21'); type2Codes = @('10','12'); available = ($type1Rows.Code -contains '21'); description = 'حساب‌های پرداختنی' }
    cash_bank = [PSCustomObject]@{ type3Codes = @('01','02'); available = $true; description = 'نقدی و بانکی' }
    cogs = [PSCustomObject]@{ type1Codes = @('61') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '61'); description = 'بهای تمام‌شده' }
    payroll = [PSCustomObject]@{ type1Codes = @('61'); type2Codes = @('10'); available = ($type1Rows.Code -contains '61'); description = 'حقوق و دستمزد' }
    tax_paid = [PSCustomObject]@{ type1Codes = @('11','12'); titlePattern = 'مالیات'; available = ($type1Rows.Code -contains '11' -or $type1Rows.Code -contains '12'); description = 'مالیات پرداختی' }
    tax_collected = [PSCustomObject]@{ type1Codes = @('21','22'); titlePattern = 'مالیات'; available = ($type1Rows.Code -contains '21' -or $type1Rows.Code -contains '22'); description = 'مالیات دریافتی' }
    tax_liability = [PSCustomObject]@{ titlePattern = 'مالیات'; available = $true; description = 'بدهی مالیاتی' }
    depreciation = [PSCustomObject]@{ titlePattern = 'استهلاک'; available = $true; description = 'استهلاک تجمعی' }
    fixed_assets_register = [PSCustomObject]@{ type3Codes = @('06'); available = $true; description = 'دارایی‌های ثابت' }
    revenue_and_expenses = [PSCustomObject]@{ type1Codes = @('41','61','62') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '41' -or $type1Rows.Code -contains '61'); description = 'درآمد و هزینه‌ها' }
    balance_sheet_accounts = [PSCustomObject]@{ type1Codes = @('11','12','21','22','31') | Where-Object { $type1Rows.Code -contains $_ }; available = ($type1Rows.Code -contains '11'); description = 'حساب‌های ترازنامه' }
  }
}

# ─── Step 4: Balance validation ──────────────────────────────────────────────
Write-Host "[4/5] Running balance validation..." -ForegroundColor Yellow

$assetsQuery = "SELECT ISNULL(SUM(Debit-Credit),0) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('11','12')))"
$liabilitiesQuery = "SELECT ISNULL(SUM(Credit-Debit),0) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('21','22')))"
$equityQuery = "SELECT ISNULL(SUM(Credit-Debit),0) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code='31'))"
$debitCreditQuery = "SELECT SUM(Debit) as totalDebit, SUM(Credit) as totalCredit FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId WHERE v.Type NOT IN (3,4)"

$assets = 0; $liabilities = 0; $equity = 0; $totalDebit = 0; $totalCredit = 0

try {
  $conn = New-Object System.Data.SqlClient.SqlConnection($connString)
  $conn.Open()

  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $assetsQuery
  $assets = [decimal]$cmd.ExecuteScalar()

  $cmd.CommandText = $liabilitiesQuery
  $liabilities = [decimal]$cmd.ExecuteScalar()

  $cmd.CommandText = $equityQuery
  $equity = [decimal]$cmd.ExecuteScalar()

  $cmd.CommandText = $debitCreditQuery
  $reader = $cmd.ExecuteReader()
  if ($reader.Read()) {
    $totalDebit = [decimal]$reader['totalDebit']
    $totalCredit = [decimal]$reader['totalCredit']
  }
  $reader.Close()
  $conn.Close()
} catch {
  Write-Host "ERROR: Balance validation failed: $_" -ForegroundColor Red
  exit 1
}

$equationDiff = $assets - ($liabilities + $equity)
$equationValid = [Math]::Abs($equationDiff) -lt 1
$dcDiff = $totalDebit - $totalCredit
$dcValid = [Math]::Abs($dcDiff) -lt 1

Write-Host "  Assets = $assets" -ForegroundColor Gray
Write-Host "  Liabilities = $liabilities" -ForegroundColor Gray
Write-Host "  Equity = $equity" -ForegroundColor Gray
Write-Host "  Accounting Equation: A = L + E => diff = $equationDiff" -ForegroundColor $(if ($equationValid) { 'Green' } else { 'Red' })
Write-Host "  Total Debit = $totalDebit" -ForegroundColor Gray
Write-Host "  Total Credit = $totalCredit" -ForegroundColor Gray
Write-Host "  Debit-Credit diff = $dcDiff" -ForegroundColor $(if ($dcValid) { 'Green' } else { 'Red' })
Write-Host ""

# ─── Step 5: Write output ────────────────────────────────────────────────────
Write-Host "[5/5] Writing calibration output to $OutputPath..." -ForegroundColor Yellow

$calibrationResult = [PSCustomObject]@{
  mapping = $mapping
  validation = [PSCustomObject]@{
    accountingEquation = [PSCustomObject]@{
      assets = $assets
      liabilities = $liabilities
      equity = $equity
      difference = $equationDiff
      valid = $equationValid
    }
    debitCreditBalance = [PSCustomObject]@{
      totalDebit = $totalDebit
      totalCredit = $totalCredit
      difference = $dcDiff
      valid = $dcValid
    }
    allValid = ($equationValid -and $dcValid)
  }
  type1Accounts = $type1Rows
  type2Accounts = $type2Rows
}

$json = $calibrationResult | ConvertTo-Json -Depth 10
Set-Content -Path $OutputPath -Value $json -Encoding UTF8

Write-Host "  Written to $OutputPath" -ForegroundColor Green
Write-Host ""

# ─── Summary ─────────────────────────────────────────────────────────────────
Write-Host "=== Calibration Summary ===" -ForegroundColor Cyan
Write-Host "  Type 1 accounts: $($type1Rows.Count)" -ForegroundColor Gray
Write-Host "  Type 2 accounts: $($type2Rows.Count)" -ForegroundColor Gray
Write-Host "  Confidence: $confidence" -ForegroundColor $(if ($confidence -eq 'high') { 'Green' } elseif ($confidence -eq 'medium') { 'Yellow' } else { 'Red' })
Write-Host "  Accounting equation valid: $equationValid" -ForegroundColor $(if ($equationValid) { 'Green' } else { 'Red' })
Write-Host "  Debit=Credit valid: $dcValid" -ForegroundColor $(if ($dcValid) { 'Green' } else { 'Red' })
Write-Host "  Overall: $(if ($equationValid -and $dcValid) { 'PASS' else 'FAIL' })" -ForegroundColor $(if ($equationValid -and $dcValid) { 'Green' } else { 'Red' })
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Review the mapping in $OutputPath" -ForegroundColor Gray
Write-Host "  2. If any concept is unavailable, manually update the mapping" -ForegroundColor Gray
Write-Host "  3. Place the mapping file in the deployment's config directory" -ForegroundColor Gray
