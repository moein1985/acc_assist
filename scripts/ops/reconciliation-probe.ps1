<#
.SYNOPSIS
  Phase 30 — Reconciliation Probe: two-source oracle queries.
  Proves that reconciliation metrics compare two independent DB sources.
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

# ── Helper: Run sqlcmd on remote server via plink ──────────────────────────────
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

  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
  $raw = & $PlinkExe -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" "powershell -NoProfile -EncodedCommand $encoded" 2>&1

  $line = ($raw | Out-String).Trim()
  if ($line -match '^ERROR:') {
    Write-Host " ERROR" -ForegroundColor Red
    Write-Host "    $line" -ForegroundColor Red
    return 'NULL'
  }
  if ($line -match '^RESULT:') {
    $val = ($line -replace '^RESULT:', '').Trim()
    Write-Host " $val" -ForegroundColor Green
    return $val
  }
  Write-Host " UNEXPECTED: $line" -ForegroundColor Red
  return 'NULL'
}

$fySubquery = "(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'$FiscalYear')"

# ── Reconciliation oracle queries (two-sided, recursive CTE) ──
$probes = @(
  @{ Id = 'sales_reconciliation';
     SideA_Name = 'SLS.Invoice SUM(NetPriceInBaseCurrency)';
     SideA_Sql = "SELECT ISNULL(SUM(NetPriceInBaseCurrency), 0) FROM SLS.Invoice WHERE FiscalYearRef = $fySubquery";
     SideB_Name = 'Ledger: recursive CTE from Type1 Code=41 SUM(Credit-Debit)';
     SideB_Sql = @"
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
"@;
     SideB_Note = 'Ledger revenue may include non-invoice income (service, interest, etc.)'
  },
  @{ Id = 'purchase_reconciliation';
     SideA_Name = 'INV.InventoryReceipt SUM(TotalPrice) IsReturn=0';
     SideA_Sql = "SELECT ISNULL(SUM(TotalPrice), 0) FROM INV.InventoryReceipt WHERE IsReturn = 0 AND FiscalYearRef = $fySubquery";
     SideB_Name = 'Ledger: recursive CTE from Type1 Code=62 SUM(Debit-Credit)';
     SideB_Sql = @"
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
"@;
     SideB_Note = 'Ledger purchase cost (62) vs inventory receipts total — different scopes'
  },
  @{ Id = 'inventory_reconciliation';
     SideA_Name = 'INV.InventoryReceipt SUM(TotalPrice)';
     SideA_Sql = "SELECT ISNULL(SUM(TotalPrice), 0) FROM INV.InventoryReceipt WHERE FiscalYearRef = $fySubquery";
     SideB_Name = 'Ledger: Type3 Code=03 under Type1 Code=11 SUM(Debit-Credit)';
     SideB_Sql = @"
WITH AccountTree AS (
  SELECT AccountId, Code, Type FROM ACC.Account WHERE Type = 1 AND Code = '11'
  UNION ALL
  SELECT a.AccountId, a.Code, a.Type FROM ACC.Account a JOIN AccountTree t ON a.ParentAccountRef = t.AccountId
)
SELECT ISNULL(SUM(vi.Debit - vi.Credit), 0) AS inventory_from_ledger
FROM ACC.VoucherItem vi
JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId
JOIN AccountTree at ON vi.AccountSLRef = at.AccountId
WHERE v.Type NOT IN (3, 4) AND v.FiscalYearRef = $fySubquery AND at.Code = '03' AND at.Type = 3
"@;
     SideB_Note = 'Ledger inventory account balance vs total inventory movement — different concepts'
  },
  @{ Id = 'bank_reconciliation';
     SideA_Name = 'RPA.BankAccountBalance SUM(Balance)';
     SideA_Sql = "SELECT ISNULL(SUM(Balance), 0) FROM RPA.BankAccountBalance";
     SideB_Name = 'Ledger: Type3 Code=02 under Type1 Code=11 SUM(Debit-Credit)';
     SideB_Sql = @"
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
"@;
     SideB_Note = 'RPA bank balance vs ledger bank account — timing/coverage differences expected'
  }
)

# ── Main ──────────────────────────────────────────────────────────────────────
$dateStr = Get-Date -Format 'yyyy-MM-dd'
$outputFile = "scripts\ops\reconciliation-$dateStr.md"

Write-Host '===================================================================' -ForegroundColor Cyan
Write-Host "  RECONCILIATION PROBE — Phase 30" -ForegroundColor Cyan
Write-Host "  Server: $SshHost`:$SshPort" -ForegroundColor Cyan
Write-Host "  SQL: 127.0.0.1:58033 ($SqlDatabase)" -ForegroundColor Cyan
Write-Host "  Fiscal Year: $FiscalYear" -ForegroundColor Cyan
Write-Host '===================================================================' -ForegroundColor Cyan

$results = @()

foreach ($probe in $probes) {
  Write-Host ""
  Write-Host "  [$($probe.Id)] probing..." -ForegroundColor Yellow

  # Side A
  Write-Host "    Side A ($($probe.SideA_Name)):" -NoNewline
  $valA = Invoke-SqlcmdRemote -Sql $probe.SideA_Sql -Label "$($probe.Id)_A"

  # Side B
  Write-Host "    Side B ($($probe.SideB_Name)):" -NoNewline
  $valB = Invoke-SqlcmdRemote -Sql $probe.SideB_Sql -Label "$($probe.Id)_B"

  $diff = if ($valA -ne 'NULL' -and $valB -ne 'NULL') { [decimal]$valA - [decimal]$valB } else { 'N/A' }
  $color = if ($diff -ne 'N/A' -and [math]::Abs([decimal]$diff) -lt 1) { 'Green' } else { 'Red' }
  Write-Host "    Diff (A - B): $diff" -ForegroundColor $color

  $results += [PSCustomObject]@{
    Id = $probe.Id
    SideA_Name = $probe.SideA_Name
    SideA_Value = $valA
    SideB_Name = $probe.SideB_Name
    SideB_Value = $valB
    Diff = $diff
    SideB_Note = $probe.SideB_Note
  }
}

# ── Generate report ───────────────────────────────────────────────────────────
$report = @"
# Reconciliation Probe Report — $dateStr

## Phase 30: Two-Source Reconciliation Verification

Fiscal Year: $FiscalYear
Server: $SshHost`:$SshPort → SQL 127.0.0.1:58033 ($SqlDatabase)

| Metric | Side A | Value A | Side B | Value B | Diff (A-B) |
|--------|--------|---------|--------|---------|------------|
"@

foreach ($r in $results) {
  $report += "`n| $($r.Id) | $($r.SideA_Name) | $($r.SideA_Value) | $($r.SideB_Name) | $($r.SideB_Value) | $($r.Diff) |"
}

$report += @"

## Analysis

"@

foreach ($r in $results) {
  if ($r.Diff -ne 'N/A') {
    $absDiff = [math]::Abs([decimal]$r.Diff)
    $status = if ($absDiff -lt 1) { 'MATCHED ✅' } else { 'DISCREPANCY ⚠️' }
  } else {
    $status = 'NULL VALUE ⚠️'
  }
  $report += "`n### $($r.Id)`n- Side A ($($r.SideA_Name)): $($r.SideA_Value)`n- Side B ($($r.SideB_Name)): $($r.SideB_Value)`n- Diff: $($r.Diff) → $status`n- Note: $($r.SideB_Note)`n"
}

$report | Set-Content -Path $outputFile -Encoding UTF8
Write-Host ""
Write-Host "  Report saved to: $outputFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
foreach ($r in $results) {
  if ($r.Diff -ne 'N/A') {
    $absDiff = [math]::Abs([decimal]$r.Diff)
    $status = if ($absDiff -lt 1) { '✅' } else { '⚠️' }
  } else {
    $status = '⚠️'
  }
  Write-Host "  $($r.Id): A=$($r.SideA_Value) B=$($r.SideB_Value) Diff=$($r.Diff) $status"
}
Write-Host "===================================================================" -ForegroundColor Cyan
