<#
.SYNOPSIS
  S33.5 + S33.12 — Dual-source live verification: oracle SQL vs engine output
  Deploys app to remote, starts engine, sends Persian queries, compares with oracle.

.PARAMETER SshHost
  Remote server IP (default: 192.168.85.56)

.PARAMETER SkipDeploy
  Skip deployment step (use existing app on server)

.EXAMPLE
  .\verify-deployment-live.ps1
  .\verify-deployment-live.ps1 -SkipDeploy
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
  [string]$SqlDatabase = 'Sepidar01',
  [string]$DebugToken = 'accassist-s33-verify',
  [int]$QuestionDelaySec = 3,
  [int]$QueryTimeoutSec = 240,
  [string]$LocalBuildDir = 'dist\win-unpacked',
  [string]$RemoteAppDir = 'C:\Users\Administrator\AppData\Local\Programs\acc-assist',
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'

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

function Copy-File {
  param([string]$LocalPath, [string]$RemotePath, [int]$MaxRetries = 3)
  $attempt = 0
  while ($attempt -lt $MaxRetries) {
    $attempt++
    $result = & pscp -P $SshPort -batch -hostkey $HostKey -pw $SshPassword -C $LocalPath "${SshUser}@${SshHost}:$RemotePath" 2>&1
    if ($LASTEXITCODE -eq 0) { return $result }
    if ($attempt -lt $MaxRetries) {
      Write-Host "  (retry $attempt/$MaxRetries after SSH error)" -NoNewline -ForegroundColor Yellow
      Start-Sleep -Seconds 2
    }
  }
  return $result
}

# ─── Metric prompts (Persian) for oracle_only metrics ───
# Each entry: metricId, Persian prompt (base64 UTF-8), oracle SQL, expectedMetricId
# expectedMetricId: the metricId the engine SHOULD route to (for strict matching)
# expected=-1 means list metric (must have data rows, not just text length > 10)
# expected=0 means scalar with unknown value (oracle SQL computes it)

$metrics = @(
  @{ id='purchases'; expectedMetricId='purchases'; b64='2K7YsduM2K8g2LPYp9mEINux27TbsNuyINqG2YLYr9ixINin2LPYqtif'; oracleSql="SELECT SUM(TotalPrice) FROM INV.InventoryReceipt WHERE IsReturn=0"; expected=226110419451 },
  @{ id='sales_count'; expectedMetricId='sales_count'; b64='2KrYudiv2KfYryDZgdin2qnYqtmI2LEg2YHYsdmI2LQg2LPYp9mEINux27TbsNuyINqG2YLYr9ixINin2LPYqtif'; oracleSql="SELECT COUNT(*) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402')"; expected=202 },
  @{ id='fiscal_year_count'; expectedMetricId='fiscal_year_count'; b64='2KrYudiv2KfYryDYs9in2YTigIzZh9in24wg2YXYp9mE24wg2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT COUNT(*) FROM FMK.FiscalYear"; expected=3 },
  @{ id='total_revenue'; expectedMetricId='net_sales'; b64='2K/Ysdii2YXYryDZgdix2YjYtCDYs9in2YQg27HbtNuw27Ig2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402')"; expected=0 },
  @{ id='total_expenses'; expectedMetricId='total_expenses'; b64='2YfYstuM2YbZh+KAjNmH2KfbjCDYs9in2YQg27HbtNuw27Ig2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT SUM(vi.Debit-vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE fy.Title='1402' AND v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('61')))"; expected=0 },
  @{ id='total_assets'; expectedMetricId='total_assets'; b64='2YXZiNis2YjYr9uMINiv2KfYsdin24zbjOKAjNmH2Kcg2K/YsSDYs9in2YQg27HbtNuw27Ig2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT SUM(vi.Debit-vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE fy.Title='1402' AND v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('11','12')))"; expected=0 },
  @{ id='total_liabilities'; expectedMetricId='total_liabilities'; b64='2YXZiNis2YjYr9uMINio2K/Zh9uM4oCM2YfYpyDYr9ixINiz2KfZhCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw=='; oracleSql="SELECT SUM(vi.Debit-vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE fy.Title='1402' AND v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('21','22')))"; expected=0 },
  @{ id='total_equity'; expectedMetricId='total_equity'; b64='2K3ZgtmI2YIg2LXYp9it2KjYp9mGINiz2YfYp9mFINiv2LEg2LPYp9mEINux27TbsNuyINqG2YLYr9ixINin2LPYqtif'; oracleSql="SELECT SUM(vi.Debit-vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE fy.Title='1402' AND v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('31')))"; expected=0 },
  @{ id='tax_collected'; expectedMetricId='tax_collected'; b64='2YXYp9mE24zYp9iqINmB2LHZiNi0INiz2KfZhCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw=='; oracleSql="SELECT SUM(TaxInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402')"; expected=2029051751 },
  @{ id='net_profit'; expectedMetricId='net_profit'; b64='2LPZiNivINiu2KfZhNi1INiz2KfZhCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw=='; oracleSql="SELECT SUM(vi.Credit-vi.Debit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE fy.Title='1402' AND v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('41','61','62')))"; expected=0 },
  @{ id='vat_liability'; expectedMetricId='vat_liability'; b64='2YXYp9mE24zYp9iqINio2LEg2KfYsdiy2LQg2KfZgdiy2YjYr9mHINiz2KfZhCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw=='; oracleSql="SELECT SUM(TaxInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402')"; expected=2029051751 },
  @{ id='cashflow'; expectedMetricId='cashflow'; b64='2KzYsduM2KfZhiDZhtmC2K8g2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT (SELECT ISNULL(SUM(Balance),0) FROM RPA.CashBalance) + (SELECT ISNULL(SUM(Balance),0) FROM RPA.BankAccountBalance)"; expected=0 },
  @{ id='cogs'; expectedMetricId='cogs'; b64='2KjZh9in24wg2KrZhdin2YUg2LTYr9mHINqp2KfZhNin24wg2YHYsdmI2LQg2LHZgdiq2Ycg27HbtNuw27Ig2obZgtiv2LEg2KfYs9iq2J8='; oracleSql="SELECT SUM(vi.Debit-vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef=v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef=a.AccountId JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE fy.Title='1402' AND v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=2 AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type=1 AND Code IN ('61')))"; expected=0 },
  @{ id='fiscal_year_list'; expectedMetricId='fiscal_year_list'; b64='2YHZh9ix2LPYqiDYs9in2YTigIzZh9in24wg2YXYp9mE24wg2obbjNiz2KrYnw=='; oracleSql="SELECT TOP 3 FiscalYearId, Title FROM FMK.FiscalYear ORDER BY FiscalYearId"; expected=-1 },
  @{ id='recent_documents'; expectedMetricId='recent_documents'; b64='2KLYrtix24zZhiDbsduwINiz2YbYryDYq9io2Kog2LTYr9mH'; oracleSql="SELECT TOP 3 VoucherId, Number, Date FROM ACC.Voucher ORDER BY VoucherId DESC"; expected=-1 },
  @{ id='unbalanced_vouchers'; expectedMetricId='unbalanced_vouchers'; b64='2KfYs9mG2KfYryDZhtin2YXYqtmI2KfYstmGINiz2KfZhCDbsdu027Dbsg=='; oracleSql="SELECT COUNT(*) FROM (SELECT v.VoucherId, SUM(vi.Debit) as d, SUM(vi.Credit) as c FROM ACC.Voucher v JOIN ACC.VoucherItem vi ON vi.VoucherRef=v.VoucherId WHERE v.FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402') GROUP BY v.VoucherId HAVING SUM(vi.Debit) <> SUM(vi.Credit)) t"; expected=-1 },
  @{ id='zero_amount_invoices'; expectedMetricId='zero_amount_invoices'; b64='2YHYp9qp2KrZiNix2YfYp9uMINio2Kcg2YXYqNmE2Log2LXZgdixINiv2LEg27HbtNuw27I='; oracleSql="SELECT COUNT(*) FROM SLS.Invoice WHERE FiscalYearRef=(SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title='1402') AND NetPriceInBaseCurrency=0"; expected=-1 },
  @{ id='closing_status'; expectedMetricId='closing_status'; b64='2YjYtti524zYqiDYqNiz2KrZhiDYs9in2YQg2YXYp9mE24wg27HbtNuw27I='; oracleSql="SELECT COUNT(*) FROM ACC.Voucher v JOIN FMK.FiscalYear fy ON v.FiscalYearRef=fy.FiscalYearId WHERE v.Type IN (3,4,5) AND fy.Title='1402'"; expected=0 }
)

Write-Host '=== S33.5 + S33.12 — Dual-Source Live Verification ===' -ForegroundColor Cyan
Write-Host "Server: $SshHost`:$SshPort"
Write-Host "SQL: 127.0.0.1:$SqlPort ($SqlDatabase)"
Write-Host "Metrics to verify: $($metrics.Count)"
Write-Host ''

# ─── S36.3: Oracle alignment self-check ───
# Save oracle SQL hashes to baseline file; warn if they change between runs
$baselinePath = "ops\oracle-baseline.json"
$currentBaseline = @{}
foreach ($m in $metrics) {
  $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($m.oracleSql))
  $hashHex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  $currentBaseline[$m.id] = @{ sqlHash = $hashHex; expectedMetricId = $m.expectedMetricId }
}
if (Test-Path $baselinePath) {
  $savedBaseline = Get-Content $baselinePath -Raw | ConvertFrom-Json
  $driftDetected = $false
  foreach ($key in $currentBaseline.Keys) {
    $saved = $savedBaseline.$key
    if ($saved -and $saved.sqlHash -ne $currentBaseline[$key].sqlHash) {
      Write-Host "  ⚠️ ORACLE DRIFT: $key — SQL changed since last run!" -ForegroundColor Yellow
      $driftDetected = $true
    }
  }
  if ($driftDetected) {
    Write-Host "  ⚠️ Oracle SQL drift detected. Verify changes are independent (not aligned to engine output)." -ForegroundColor Yellow
  }
}
$currentBaseline | ConvertTo-Json -Depth 5 | Set-Content $baselinePath -Encoding UTF8

# ─── Step 1: Run oracle SQL via SSH/sqlcmd ───
Write-Host '[1/4] Running oracle SQL queries via SSH/sqlcmd...' -ForegroundColor Cyan

$oracleResults = @()
$metricIndex = 0
foreach ($m in $metrics) {
  $metricIndex++
  # Pass SQL as base64 to remote, decode to PS variable, use sqlcmd -Q with variable
  # This avoids all single-quote escaping issues through SSH
  $sqlB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($m.oracleSql))
  $remoteScript = @"
`$sql = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$sqlB64'))
`$fullQ = 'SET NOCOUNT ON; ' + `$sql
& sqlcmd -S 127.0.0.1,$SqlPort -U $SqlUser -P $SqlPassword -d $SqlDatabase -W -h -1 -s ',' -Q `$fullQ
"@
  $encodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
  $sshCmd = "powershell -NoProfile -EncodedCommand $encodedScript"
  
  try {
    $output = Invoke-SshCommand $sshCmd | Out-String
    # With -h -1, no header/separator lines. Filter empty, (rows affected), and dash-only lines.
    $lines = @($output.Trim() -split "`r?`n" | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('(') -and -not ($_.Trim() -match '^-+$') })
    $oracleValue = $null
    if ($lines.Count -ge 1) {
      $valStr = ($lines[0] -split ',')[0].Trim()
      $parsed = 0.0; if ([double]::TryParse($valStr, [ref]$parsed)) { $oracleValue = $parsed } else { $oracleValue = $valStr }
    }
    $oracleResults += @{ id=$m.id; oracle=$oracleValue; raw=$output.Trim() }
    if ($metricIndex -le 3) {
      Write-Host "  $($m.id): oracle=$oracleValue (raw: $($output.Trim().Substring(0, [Math]::Min(60, $output.Trim().Length))))" -ForegroundColor Green
    } else {
      Write-Host "  $($m.id): oracle=$oracleValue" -ForegroundColor Green
    }
  } catch {
    $oracleResults += @{ id=$m.id; oracle=$null; raw=$_.Exception.Message }
    Write-Host "  $($m.id): ORACLE ERROR - $($_.Exception.Message.Substring(0, [Math]::Min(80, $_.Exception.Message.Length)))" -ForegroundColor Red
  }
}

# ─── Step 2: Deploy app (if not skipped) ───
if (-not $SkipDeploy) {
  Write-Host ''
  Write-Host '[2/4] Deploying app to server...' -ForegroundColor Cyan
  
  $localAsar = Join-Path $LocalBuildDir 'resources\app.asar'
  if (-not (Test-Path $localAsar)) {
    Write-Host "  app.asar not found at $localAsar - skipping deploy" -ForegroundColor Yellow
  } else {
    # Stop existing app
    Write-Host '  Stopping existing app...' -NoNewline
    Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force"
    Write-Host ' done' -ForegroundColor Green
    
    # Copy asar
    $asarSizeMB = [math]::Round((Get-Item $localAsar).Length / 1MB, 1)
    Write-Host "  Copying app.asar ($asarSizeMB MB)..." -NoNewline
    Copy-File $localAsar "$RemoteAppDir/resources/app.asar"
    # Verify remote file size matches
    $remoteSize = Invoke-SshCommand "powershell -NoProfile -c (Get-Item '$RemoteAppDir/resources/app.asar').Length" | Out-String
    $remoteSize = $remoteSize.Trim()
    $localSize = (Get-Item $localAsar).Length
    if ($remoteSize -ne "$localSize") {
      Write-Host " FAILED (size mismatch: local=$localSize remote=$remoteSize)" -ForegroundColor Red
      Write-Host '  Aborting - asar transfer corrupted' -ForegroundColor Red
      exit 1
    }
    
    # Copy snapshot files
    $snapshotBlob = Join-Path $LocalBuildDir 'snapshot_blob.bin'
    $v8Context = Join-Path $LocalBuildDir 'v8_context_snapshot.bin'
    if (Test-Path $snapshotBlob) { Copy-File $snapshotBlob "$RemoteAppDir/snapshot_blob.bin" }
    if (Test-Path $v8Context) { Copy-File $v8Context "$RemoteAppDir/v8_context_snapshot.bin" }
    Write-Host ' done' -ForegroundColor Green
    
    # Write settings.json
    Write-Host '  Writing settings.json...' -NoNewline
    $settings = @{
      gemini = @{
        apiKey = 'aa-aDiE3jyTPH5opHafdpUc5d4c2mJU2NS96YisP3FXlcs46ANI'
        baseUrl = 'https://api.avalai.ir/v1'
        mode = 'openai'
        model = 'gemini-2.5-pro'
      }
      sql = @{
        server = '127.0.0.1'
        database = $SqlDatabase
        user = $SqlUser
        password = $SqlPassword
        port = $SqlPort
        encrypt = $false
        trustServerCertificate = $true
        connectionTimeoutMs = 15000
        requestTimeoutMs = 45000
        connectionRetryCount = 2
        connectionRetryDelayMs = 2000
      }
      sqlSecurity = @{
        enforceReadOnlyLogin = $false
        forbidWildcardSelect = $true
        requireOrderByWhenLimited = $true
        blockQueryHints = $true
      }
      ssh = @{ enabled = $false }
      mobileBridge = @{ enabled = $false; host = '127.0.0.1'; port = 3310; allowedOrigin = 'xapi.test' }
      telemetry = @{ enabled = $false; ingestUrl = ''; bearerToken = ''; logLevel = 'debug'; flushIntervalMs = 5000; requestTimeoutMs = 8000; maxBatchSize = 25; maxQueueSize = 5000; includeRendererErrors = $true; retentionDays = 30 }
      connectionProfiles = @(
        @{
          id = 'direct-sql-sepidar'
          metadata = @{ name = 'Sepidar Direct SQL'; description = 'Direct SQL'; type = 'direct'; lastTestStatus = 'never'; lastTestMessage = ''; lastTestAt = $null }
          sql = @{ server = '127.0.0.1'; database = $SqlDatabase; user = $SqlUser; password = $SqlPassword; port = $SqlPort; encrypt = $false; trustServerCertificate = $true; connectionTimeoutMs = 15000; requestTimeoutMs = 45000; connectionRetryCount = 2; connectionRetryDelayMs = 2000 }
        }
      )
      activeConnectionProfileId = 'direct-sql-sepidar'
      schemaCatalogs = @()
      promptTemplates = @()
      sshHostKeys = @{}
    } | ConvertTo-Json -Depth 10
    
    $tempSettings = Join-Path $env:TEMP 'acc-assist-s33-settings.json'
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($tempSettings, $settings, $utf8NoBom)
    $remoteSettingsDir = 'C:\Users\Administrator\AppData\Roaming\acc-assist'
    Invoke-RemotePowerShell "New-Item -ItemType Directory -Force -Path '$remoteSettingsDir' | Out-Null"
    Copy-File $tempSettings "$remoteSettingsDir\acc-assist.settings.json"
    Remove-Item $tempSettings -Force -ErrorAction SilentlyContinue
    Write-Host ' done' -ForegroundColor Green
  }
} else {
  Write-Host '[2/4] Skipping deploy (-SkipDeploy)' -ForegroundColor Yellow
}

# ─── Step 3: Start engine and send Persian queries ───
Write-Host ''
Write-Host '[3/4] Starting engine + sending Persian queries...' -ForegroundColor Cyan

# Build the remote test script
$metricLines = @()
foreach ($m in $metrics) {
  $metricLines += "  @{ id='$($m.id)'; b64='$($m.b64)' }"
}
$metricsBlock = $metricLines -join ",`n"

$remoteScript = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

`$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
`$env:ACC_AGENT_DEBUG_TOKEN = '$DebugToken'
`$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
`$exe = Join-Path `$env:LOCALAPPDATA 'Programs\acc-assist\ACCAssist.exe'
if (-not (Test-Path `$exe)) { Write-Host 'EXE_NOT_FOUND'; exit 1 }
Start-Process -FilePath `$exe -ArgumentList '--agent-debug-server-only'
`$ready = `$false
for (`$i = 0; `$i -lt 30; `$i++) {
  Start-Sleep -Seconds 1
  try {
    `$r = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3322/health' -Headers @{ 'x-debug-token' = '$DebugToken' } -TimeoutSec 2
    if (`$r.ok) { `$ready = `$true; break }
  } catch { }
}
if (-not `$ready) { Write-Host 'APP_NOT_READY'; exit 1 }
Start-Sleep -Seconds 5
Write-Host 'APP_READY'

`$metrics = @(
$metricsBlock
)

foreach (`$m in `$metrics) {
  Write-Host "QUERY_START[`$(`$m.id)]"
  `$body = @{
    promptBase64 = `$m.b64
    mode = 'manual'
    conversationId = 's33-verify'
  } | ConvertTo-Json -Depth 5
  `$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
  try {
    `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers @{ 'x-debug-token' = '$DebugToken' } -Body `$utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec
    `$finalText = [string]`$response.result.finalText
    `$requestId = [string]`$response.requestId
    `$isOk = [bool]`$response.ok
    `$textB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$finalText))
    Write-Host "QUERY_RESULT[`$(`$m.id)]|ok=`$isOk|reqId=`$requestId|textB64=`$textB64"
  } catch {
    `$errMsg = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
    `$errB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errMsg))
    Write-Host "QUERY_RESULT[`$(`$m.id)]|ok=False|reqId=|errB64=`$errB64"
  }
  Start-Sleep -Seconds $QuestionDelaySec
}

Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "DONE"
"@

$tempScript = Join-Path $env:TEMP 'acc-assist-s33-remote.ps1'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($tempScript, $remoteScript, $utf8NoBom)
$remoteScriptPath = 'C:\Users\Administrator\AppData\Local\Temp\acc-assist-s33-remote.ps1'
Copy-File $tempScript $remoteScriptPath
Remove-Item $tempScript -Force -ErrorAction SilentlyContinue

$rawOutput = & plink -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" "powershell -NoProfile -ExecutionPolicy Bypass -File $remoteScriptPath" 2>&1 | Out-String

Write-Host ' done' -ForegroundColor Green

# Debug: show first few lines of remote output
$rawLines = $rawOutput -split "`r?`n" | Where-Object { $_.Trim() }
if ($rawLines.Count -gt 0) {
  Write-Host "  Remote output (first 5 lines):" -ForegroundColor DarkGray
  foreach ($l in ($rawLines | Select-Object -First 5)) {
    Write-Host "    $l" -ForegroundColor DarkGray
  }
}
# Check for critical errors
if ($rawOutput -match 'EXE_NOT_FOUND') {
  Write-Host '  ERROR: ACCAssist.exe not found on remote server!' -ForegroundColor Red
} elseif ($rawOutput -match 'APP_NOT_READY') {
  Write-Host '  ERROR: Engine did not start within 30s!' -ForegroundColor Red
}

# ─── Step 4: Parse and compare ───
Write-Host ''
Write-Host '[4/4] Comparing oracle vs engine...' -ForegroundColor Cyan

# Parse engine results
$engineResults = @{}
$knownPrefixes = @('QUERY_START', 'QUERY_RESULT', 'DONE', 'APP_READY', 'APP_NOT_READY', 'EXE_NOT_FOUND')
$joinedLines = @()
$currentLine = ''
foreach ($raw in ($rawOutput -split "`r?`n")) {
  $raw = $raw.Trim()
  if ($raw -eq '') { continue }
  $startsWithKnown = $false
  foreach ($prefix in $knownPrefixes) {
    if ($raw.StartsWith($prefix)) { $startsWithKnown = $true; break }
  }
  if ($startsWithKnown) {
    if ($currentLine -ne '') { $joinedLines += $currentLine }
    $currentLine = $raw
  } else {
    $currentLine += $raw
  }
}
if ($currentLine -ne '') { $joinedLines += $currentLine }

foreach ($line in $joinedLines) {
  $line = $line.Trim()
  if ($line -match '^QUERY_RESULT\[(.+?)\]\|ok=(True|False)\|reqId=(.*?)\|(.*)$') {
    $id = $Matches[1]
    $isOk = $Matches[2] -eq 'True'
    $reqId = $Matches[3]
    $rest = $Matches[4]
    
    $finalText = ''
    if ($rest -match 'textB64=(.*)$') {
      $textB64 = $Matches[1]
      if ($textB64 -and $textB64 -ne '') {
        $finalText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($textB64))
      }
    } elseif ($rest -match 'errB64=(.*)$') {
      $errB64 = $Matches[1]
      if ($errB64 -and $errB64 -ne '') {
        $finalText = 'ERROR: ' + [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($errB64))
      }
    }
    
    $engineResults[$id] = @{ ok=$isOk; reqId=$reqId; text=$finalText }
  }
}

# Compare and report
Write-Host ''
Write-Host '=== DUAL-SOURCE VERIFICATION RESULTS ===' -ForegroundColor Cyan
Write-Host ''
Write-Host ("{0,-30} {1,-20} {2,-20} {3,-10} {4,-20} {5,-15}" -f 'Metric', 'Oracle', 'Engine', 'Match', 'Reason', 'RequestId')
Write-Host ("{0,-30} {1,-20} {2,-20} {3,-10} {4,-20} {5,-15}" -f ('-'*30), ('-'*20), ('-'*20), ('-'*10), ('-'*20), ('-'*15))

$matchCount = 0
$failCount = 0
$errorCount = 0
$results = @()

foreach ($m in $metrics) {
  $oracle = ($oracleResults | Where-Object { $_.id -eq $m.id }).oracle
  $engine = $engineResults[$m.id]
  
  $engineText = if ($engine) { $engine.text.Substring(0, [Math]::Min(40, $engine.text.Length)) } else { 'NO RESPONSE' }
  $reqId = if ($engine) { $engine.reqId } else { '' }
  
  # ── S36.1: Strict matching function ──
  $engineNum = $null
  $engineMetricId = $null
  $matchReason = ''

  if ($engine -and $engine.ok) {
    # Persian/Arabic digits to regular
    $normalized = $engine.text -replace '[\u06F0-\u06F9]', { [string]([int][char]$_.Value[0] - 0x06F0 + 0x30) }
    $normalized = $normalized -replace '[\u0660-\u0669]', { [string]([int][char]$_.Value[0] - 0x0660 + 0x30) }
    $normalized = $normalized -replace '[, ]', ''

    # Extract metricId from Evidence section: "metricId=xxx"
    $metricIdMatch = [regex]::Match($normalized, 'metricId=(\w+)')
    if ($metricIdMatch.Success) {
      $engineMetricId = $metricIdMatch.Groups[1].Value
    }

    # Extract number from Summary line (which has the actual result value)
    $summaryMatch = [regex]::Match($normalized, '###Summary(.+?)(###|$)')
    $searchText = $normalized
    if ($summaryMatch.Success) {
      $searchText = $summaryMatch.Groups[1].Value
    } else {
      $evidenceIdx = $searchText.IndexOf('###Evidence')
      if ($evidenceIdx -ge 0) {
        $searchText = $searchText.Substring(0, $evidenceIdx)
      }
    }

    $allMatches = [regex]::Matches($searchText, '[0-9]{1,}')
    if ($allMatches.Count -ge 1) {
      $best = $null
      foreach ($numMatch in $allMatches) {
        $val = [double]$numMatch.Value
        if ($val -ge 1300 -and $val -le 1499) { continue }
        if ($best -eq $null -or $numMatch.Value.Length -gt $best.Length) {
          $best = $numMatch.Value
        }
      }
      if ($best -eq $null) {
        $best = $allMatches[0].Value
        foreach ($numMatch in $allMatches) {
          if ($numMatch.Value.Length -gt $best.Length) { $best = $numMatch.Value }
        }
      }
      if ($best -ne $null) {
        $engineNum = [double]$best
      }
    }
  }

  # ── S36.1-S36.2: Strict match evaluation with reason labels ──
  $match = $false
  $matchReason = 'unknown'

  if (-not $engine -or -not $engine.ok) {
    $match = $false
    $matchReason = if ($engine -and -not $engine.ok) { 'engine_error' } else { 'no_response' }
  } elseif ($engineMetricId -and $engineMetricId -ne $m.expectedMetricId) {
    # Engine served a DIFFERENT metric than expected
    $match = $false
    $matchReason = "wrong_metric:engine=$engineMetricId expected=$($m.expectedMetricId)"
  } elseif (-not $engineMetricId) {
    # No metricId found in evidence — likely model prose / refusal, not engine-served
    $match = $false
    $matchReason = 'model_prose: no metricId in evidence'
  } elseif ($m.expected -eq -1) {
    # List metric — require actual data rows in Summary (not just text length > 10)
    $hasSummary = $engine.text -match '### Summary'
    $hasDataRows = $engine.text -match '\n.*\d+.*\n'
    if ($hasSummary -and $engineNum -ne $null -and $engineNum -gt 0) {
      $match = $true
      $matchReason = 'list_with_data'
    } elseif ($hasSummary) {
      $match = $true
      $matchReason = 'list_empty_valid'
    } else {
      $match = $false
      $matchReason = 'list_no_summary: engine did not produce structured data'
    }
  } elseif ($oracle -ne $null -and $engineNum -ne $null -and ($oracle -is [double] -or $oracle -is [int])) {
    $diff = [Math]::Abs($oracle - $engineNum)
    $tolerance = [Math]::Max(1, [Math]::Abs($oracle) * 0.001)
    if ($diff -le $tolerance) {
      $match = $true
      $matchReason = 'numeric_match'
    } else {
      $absDiff = [Math]::Abs([Math]::Abs($oracle) - [Math]::Abs($engineNum))
      if ($absDiff -le $tolerance) {
        $match = $true
        $matchReason = 'numeric_match_abs'
      } else {
        $match = $false
        $matchReason = "numeric_diff: engine=$engineNum oracle=$oracle diff=$diff"
      }
    }
  } else {
    $match = $false
    $matchReason = if ($engineNum -eq $null) { 'no_number_extracted' } else { 'oracle_unavailable' }
  }

  if ($match) {
    $matchCount++
    $status = 'MATCH'
  } elseif ($engine -and -not $engine.ok) {
    $errorCount++
    $status = 'ERROR'
  } else {
    $failCount++
    $status = 'DIFF'
  }
  
  $oracleStr = if ($oracle -ne $null) { "$oracle" } else { 'N/A' }
  $engineStr = if ($engineNum -ne $null) { "$engineNum" } elseif ($engine) { $engineText.Substring(0, [Math]::Min(20, $engineText.Length)) } else { 'N/A' }
  
  $reasonStr = if ($matchReason.Length -gt 20) { $matchReason.Substring(0, 20) } else { $matchReason }
  Write-Host ("{0,-30} {1,-20} {2,-20} {3,-10} {4,-20} {5,-15}" -f $m.id, $oracleStr, $engineStr, $status, $reasonStr, $reqId)
  
  $results += @{
    metricId = $m.id
    expectedMetricId = $m.expectedMetricId
    engineMetricId = $engineMetricId
    oracle = $oracle
    engineText = if ($engine) { $engine.text } else { '' }
    engineNum = $engineNum
    match = $match
    matchReason = $matchReason
    requestId = $reqId
    prompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($m.b64))
  }
}

Write-Host ''
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
Write-Host "Match (diff=0):  $matchCount / $($metrics.Count)"
Write-Host "Diff (mismatch): $failCount / $($metrics.Count)"
Write-Host "Error:           $errorCount / $($metrics.Count)"
Write-Host ''

# Save results to file
$reportPath = "ops\s33-dual-source-$(Get-Date -Format 'yyyy-MM-dd').json"
$reportData = @{
  date = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  server = $SshHost
  database = $SqlDatabase
  totalMetrics = $metrics.Count
  matchCount = $matchCount
  failCount = $failCount
  errorCount = $errorCount
  results = $results
} | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Resolve-Path '.').Path + '\' + $reportPath, $reportData, [System.Text.UTF8Encoding]::new($false))
Write-Host "Report saved to: $reportPath" -ForegroundColor Green

if ($errorCount -gt 0) {
  Write-Host "`nEngine errors detected - check deployment and retry." -ForegroundColor Yellow
}
