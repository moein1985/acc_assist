<#
.SYNOPSIS
  S41.6 — Schema fingerprint collection from two Sepidar versions
#>

param(
  [string]$SshHost = '192.168.85.56',
  [int]$SshPort = 2211,
  [string]$SshUser = 'administrator',
  [string]$SshPassword = 'Hs-co@12321#',
  [string]$HostKey = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ',
  [int]$SqlPort = 58033,
  [string]$SqlUser = 'damavand',
  [string]$SqlPassword = 'damavand',
  [string[]]$Databases = @('Sepidar01', 'Sepidar03')
)

function Invoke-RemoteSql {
  param([string]$Database, [string]$Sql)
  $sqlB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Sql))
  $remoteScript = @"
`$sql = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$sqlB64'))
`$fullQ = 'SET NOCOUNT ON; ' + `$sql
& sqlcmd -S 127.0.0.1,$SqlPort -U $SqlUser -P $SqlPassword -d $Database -W -h -1 -s '|' -Q `$fullQ 2>&1
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
  $result = & plink -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" "powershell -NoProfile -EncodedCommand $encoded"
  return ($result | Where-Object { $_ -ne '' -and $_ -notmatch 'rows affected' } | ForEach-Object { $_.Trim() })
}

Write-Host '=== S41.6 — Schema Fingerprint Collection ===' -ForegroundColor Cyan
Write-Host "Server: $SshHost`:$SshPort, SQL port: $SqlPort"
Write-Host ''

$keyTables = @(
  'ACC.Voucher', 'ACC.VoucherItem', 'ACC.Account', 'ACC.Check',
  'SLS.Invoice', 'SLS.InvoiceItem',
  'INV.InventoryReceipt', 'INV.vwItemStockSummary',
  'FMK.FiscalYear',
  'RPA.CashBalance', 'RPA.BankAccountBalance',
  'AST.Asset', 'AST.AssetTransaction',
  'CNT.Project', 'CNT.CostCenter',
  'GNR.Party', 'POM.PurchaseInvoice'
)

$ccTables = @('ACC.VoucherItem', 'SLS.Invoice', 'INV.InventoryReceipt', 'AST.Asset', 'AST.AssetTransaction')
$countTables = @('ACC.Voucher', 'ACC.VoucherItem', 'SLS.Invoice', 'FMK.FiscalYear', 'GNR.Party', 'INV.InventoryReceipt')

foreach ($db in $Databases) {
  Write-Host "=== DATABASE: $db ===" -ForegroundColor Yellow

  Write-Host '--- Table Existence ---'
  foreach ($t in $keyTables) {
    $parts = $t.Split('.')
    $sql = "SELECT COUNT(*) FROM information_schema.tables WHERE TABLE_SCHEMA='$($parts[0])' AND TABLE_NAME='$($parts[1])'"
    $r = Invoke-RemoteSql -Database $db -Sql $sql
    Write-Host "  $t => $r"
  }

  Write-Host '--- AST.Asset Columns ---'
  $sql = "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA='AST' AND TABLE_NAME='Asset' ORDER BY ORDINAL_POSITION"
  $cols = Invoke-RemoteSql -Database $db -Sql $sql
  $cols | ForEach-Object { Write-Host "    $_" }

  Write-Host '--- ACC.VoucherItem Columns ---'
  $sql = "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA='ACC' AND TABLE_NAME='VoucherItem' ORDER BY ORDINAL_POSITION"
  $cols = Invoke-RemoteSql -Database $db -Sql $sql
  $cols | ForEach-Object { Write-Host "    $_" }

  Write-Host '--- SLS.Invoice Columns ---'
  $sql = "SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA='SLS' AND TABLE_NAME='Invoice' ORDER BY ORDINAL_POSITION"
  $cols = Invoke-RemoteSql -Database $db -Sql $sql
  $cols | ForEach-Object { Write-Host "    $_" }

  Write-Host '--- Row Counts ---'
  foreach ($t in $countTables) {
    $sql = "SELECT COUNT(*) FROM $t"
    $r = Invoke-RemoteSql -Database $db -Sql $sql
    Write-Host "  $t => $r rows"
  }

  Write-Host '--- CostCenterRef Presence ---'
  foreach ($t in $ccTables) {
    $parts = $t.Split('.')
    $sql = "SELECT COUNT(*) FROM information_schema.columns WHERE TABLE_SCHEMA='$($parts[0])' AND TABLE_NAME='$($parts[1])' AND COLUMN_NAME='CostCenterRef'"
    $r = Invoke-RemoteSql -Database $db -Sql $sql
    Write-Host "  $t.CostCenterRef => $r"
  }

  Write-Host '--- Voucher Type Values ---'
  $sql = "SELECT DISTINCT Type FROM ACC.Voucher ORDER BY Type"
  $r = Invoke-RemoteSql -Database $db -Sql $sql
  Write-Host "  ACC.Voucher.Type => $($r -join ', ')"

  Write-Host '--- RPA Schema Tables ---'
  $sql = "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA='RPA' ORDER BY TABLE_NAME"
  $r = Invoke-RemoteSql -Database $db -Sql $sql
  if ($r) { $r | ForEach-Object { Write-Host "    RPA.$_" } } else { Write-Host '    (no RPA tables)' }

  Write-Host '--- CNT Schema Tables ---'
  $sql = "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA='CNT' ORDER BY TABLE_NAME"
  $r = Invoke-RemoteSql -Database $db -Sql $sql
  if ($r) { $r | ForEach-Object { Write-Host "    CNT.$_" } } else { Write-Host '    (no CNT tables)' }

  Write-Host '--- AST Schema Tables ---'
  $sql = "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA='AST' ORDER BY TABLE_NAME"
  $r = Invoke-RemoteSql -Database $db -Sql $sql
  if ($r) { $r | ForEach-Object { Write-Host "    AST.$_" } } else { Write-Host '    (no AST tables)' }

  Write-Host '--- All Schemas ---'
  $sql = "SELECT TABLE_SCHEMA, COUNT(*) as tbl_count FROM information_schema.tables WHERE TABLE_TYPE='BASE TABLE' GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA"
  $r = Invoke-RemoteSql -Database $db -Sql $sql
  $r | ForEach-Object { Write-Host "  $_" }

  Write-Host ''
}

Write-Host '=== Done ===' -ForegroundColor Green
