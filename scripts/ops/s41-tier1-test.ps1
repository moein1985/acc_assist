<#
.SYNOPSIS
  S41.7 — Run Tier 1 metrics on both Sepidar01 and Sepidar03
  Compares engine output with independent oracle (sqlcmd)
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
  [string]$DebugToken = 'accassist-s41-test',
  [string[]]$Databases = @('Sepidar01', 'Sepidar03')
)

# Tier 1 metrics: id, Persian prompt (base64), oracle SQL
$tier1 = @(
  @{ id='net_sales'; b64='2K/Ysdii2YXYryDZgdix2YjYtCDYs9in2YQg27HbtNuw27Ig2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402')" },
  @{ id='sales_count'; b64='2KrYudiv2KfYryDZgdin2qnYqtmI2LEg2YHYsdmI2LQg2LPYp9mEINux27TbsNuyINqG2YLYr9ixINin2LPYqtif'; oracleSql="SELECT COUNT(*) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402')" },
  @{ id='purchases'; b64='2K7YsduM2K8g2LPYp9mEINux27TbsNuyINqG2YLYr9ixINin2LPYqtif'; oracleSql="SELECT SUM(TotalPrice) FROM INV.InventoryReceipt WHERE IsReturn=0" },
  @{ id='tax_collected'; b64='2YXYp9mE24zYp9iqINmB2LHZiNi0INiz2KfZhCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw=='; oracleSql="SELECT SUM(TaxInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402')" },
  @{ id='fiscal_year_count'; b64='2KrYudiv2KfYryDYs9in2YTigIzZh9in24wg2YXYp9mE24wg2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT COUNT(*) FROM FMK.FiscalYear" },
  @{ id='cashflow'; b64='2KzYsduM2KfZhiDZhtmC2K8g2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT (SELECT ISNULL(SUM(Balance),0) FROM RPA.CashBalance) + (SELECT ISNULL(SUM(Balance),0) FROM RPA.BankAccountBalance)" },
  @{ id='party_count'; b64='2KrYudiv2KfYryDYs9in2YTigIzZh9in24wg2YXYp9mE24wg2obbjNiz2KrYnw=='; oracleSql="SELECT COUNT(*) FROM GNR.Party" },
  @{ id='voucher_count'; b64='2KrYudiv2KfYryDZhtin2YXYqtmI2KfYstmGINiz2KfZhCDbsdu027Dbsg=='; oracleSql="SELECT COUNT(*) FROM ACC.Voucher" }
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
  return ($result | Where-Object { $_ -ne '' -and $_ -notmatch 'rows affected' -and $_ -notmatch 'CLIXML' } | ForEach-Object { $_.Trim() })
}

function Ask-Engine {
  param([string]$PromptB64)
  $result = & npm run remote:ask-ai -- -ServerHost $SshHost -User $SshUser -Password $SshPassword -HostKey $HostKey -PromptB64 $PromptB64 -DebugToken $DebugToken 2>&1
  return ($result | Out-String)
}

$results = @()

foreach ($db in $Databases) {
  Write-Host ""
  Write-Host "=== DATABASE: $db ===" -ForegroundColor Cyan

  # Write settings for this database
  Write-Host "[Setup] Writing settings for $db..." -ForegroundColor Yellow
  & npm run remote:write-settings -- -ServerHost $SshHost -User $SshUser -Password $SshPassword -HostKey $HostKey -SqlDatabase $db -SqlUser $SqlUser -SqlPassword $SqlPassword -SqlPort $SqlPort 2>&1 | Out-Null

  # Stop and restart app
  Write-Host "[Setup] Restarting app..." -ForegroundColor Yellow
  & npm run remote:stop -- -ServerHost $SshHost -User $SshUser -Password $SshPassword -HostKey $HostKey 2>&1 | Out-Null
  Start-Sleep -Seconds 2

  # Run oracle queries
  Write-Host ""
  Write-Host "[Oracle] Running independent SQL queries..." -ForegroundColor Yellow
  foreach ($m in $tier1) {
    $oracleVal = Invoke-RemoteSql -Database $db -Sql $m.oracleSql
    Write-Host "  $($m.id): oracle=$oracleVal"
    $results += [PSCustomObject]@{
      Database = $db
      MetricId = $m.id
      OracleValue = $oracleVal
      EngineValue = ''
      Match = ''
      Notes = ''
    }
  }

  # Run engine queries
  Write-Host ""
  Write-Host "[Engine] Running Tier 1 metrics via engine..." -ForegroundColor Yellow
  foreach ($m in $tier1) {
    $prompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($m.b64))
    Write-Host -NoNewline "  $($m.id): "
    $engineOutput = & npm run remote:ask-ai -- -ServerHost $SshHost -User $SshUser -Password $SshPassword -HostKey $HostKey -Prompt $prompt -DebugToken $DebugToken 2>&1 | Out-String
    
    # Extract numeric value from engine output
    $engineVal = ''
    if ($engineOutput -match 'result_value.*?([\d,\.]+)') {
      $engineVal = $matches[1]
    } elseif ($engineOutput -match 'Summary.*?([\d,\.]+)') {
      $engineVal = $matches[1]
    } elseif ($engineOutput -match 'metricId=' + $m.id) {
      $engineVal = 'engine-served'
    }
    
    # Check for refusal
    if ($engineOutput -match 'refusalReason|در دسترس نیست') {
      $engineVal = 'REFUSED'
    }
    
    Write-Host $engineVal
    
    # Update results
    $lastResult = $results | Where-Object { $_.Database -eq $db -and $_.MetricId -eq $m.id } | Select-Object -Last 1
    if ($lastResult) {
      $lastResult.EngineValue = $engineVal
      if ($engineVal -eq 'REFUSED') {
        $lastResult.Match = 'N/A (refused)'
      } elseif ($engineVal -eq 'engine-served') {
        $lastResult.Match = 'engine-served'
      } elseif ($lastResult.OracleValue -and $engineVal) {
        $oracleNum = $lastResult.OracleValue -replace '[, ]', ''
        $engineNum = $engineVal -replace '[, ]', ''
        if ($oracleNum -eq $engineNum) {
          $lastResult.Match = 'MATCH'
        } else {
          $lastResult.Match = 'MISMATCH'
        }
      }
    }
  }
}

# Summary table
Write-Host ""
Write-Host "=== S41.7 RESULTS SUMMARY ===" -ForegroundColor Green
$results | Format-Table -AutoSize

# Save to file
$results | Export-Csv -Path 'ops\s41-tier1-results.csv' -NoTypeInformation -Encoding UTF8
Write-Host "Results saved to ops\s41-tier1-results.csv" -ForegroundColor Green
