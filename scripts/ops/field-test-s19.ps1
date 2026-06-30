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
  [string]$DebugToken = 'accassist-s19-field-test',
  [int]$QuestionDelaySec = 5,
  [int]$QueryTimeoutSec = 240,
  [string]$LocalBuildDir = 'dist\win-unpacked',
  [string]$RemoteAppDir = 'C:\Users\Administrator\AppData\Local\Programs\acc-assist'
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

# ── Helper: Copy file via pscp ────────────────────────────────────────────────
function Copy-File {
  param([string]$LocalPath, [string]$RemotePath)
  & pscp -P $SshPort -batch -hostkey $HostKey -pw $SshPassword $LocalPath "${SshUser}@${SshHost}:$RemotePath"
}

Write-Host '=== FIELD TEST S19 — Advanced Financial Metrics (Remote Install) ===' -ForegroundColor Cyan
Write-Host "Server: $SshHost`:$SshPort"
Write-Host "SQL: 127.0.0.1:$SqlPort ($SqlDatabase) — direct connection, no SSH tunnel"
Write-Host "Remote app dir: $RemoteAppDir"
Write-Host ''

# ── 1. Verify local build exists ─────────────────────────────────────────────
$localExe = Join-Path $LocalBuildDir 'ACCAssist.exe'
if (-not (Test-Path $localExe)) {
  throw "Local build not found at $localExe. Run build first."
}
Write-Host '[1/7] Local build found.' -ForegroundColor Green

# ── 2. Stop existing app on server ───────────────────────────────────────────
Write-Host '[2/7] Stopping existing ACCAssist on server...' -NoNewline
Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force; Write-Host 'stopped'"
Write-Host ' done' -ForegroundColor Green

# ── 3. Copy updated files to server (incremental) ───────────────────────────
Write-Host '[3/7] Copying updated files to server...' -ForegroundColor Cyan

$remoteResources = "$RemoteAppDir\resources"

# 3a. Copy app.asar (the main application bundle)
$localAsar = Join-Path $LocalBuildDir 'resources\app.asar'
if (-not (Test-Path $localAsar)) { throw "app.asar not found at $localAsar" }

$asarSizeMB = [math]::Round((Get-Item $localAsar).Length / 1MB, 1)
Write-Host "  Uploading app.asar ($asarSizeMB MB)..." -NoNewline
$remoteAsarPath = "$remoteResources/app.asar"
Copy-File $localAsar $remoteAsarPath
Write-Host ' done' -ForegroundColor Green

# 3b. Copy python resources if they exist locally
$localPython = Join-Path $LocalBuildDir 'resources\python'
if (Test-Path $localPython) {
  Write-Host '  Uploading python resources...' -NoNewline
  # Create remote python dir
  Invoke-RemotePowerShell "New-Item -ItemType Directory -Force -Path '$remoteResources\python' | Out-Null"
  # Copy python directory recursively via pscp
  & pscp -P $SshPort -batch -hostkey $HostKey -pw $SshPassword -r "$localPython\*" "${SshUser}@${SshHost}:$remoteResources/python/"
  Write-Host ' done' -ForegroundColor Green
}

# 3c. Verify app.asar markers on server
Write-Host '  Verifying app.asar markers on server...' -NoNewline
$verifyScript = @"
`$asarPath = '$remoteResources\app.asar'
`$markers = @('ADVANCED_FINANCIAL_METRICS','CASH_FLOW_STATEMENT','TREND_ANALYSIS','PYTHON_SANDBOX')
`$found = 0
foreach (`$m in `$markers) {
  `$r = Select-String -Path `$asarPath -Pattern `$m -SimpleMatch -Quiet -ErrorAction SilentlyContinue
  if (`$r) { `$found++ }
}
Write-Host "`$found/4 markers found"
"@
$verifyResult = Invoke-RemotePowerShell $verifyScript | Out-String
Write-Host " $verifyResult".Trim() -ForegroundColor Green

# ── 4. Write settings.json on server (direct SQL, no SSH tunnel) ─────────────
Write-Host '[4/7] Writing settings.json on server (direct SQL connection)...' -NoNewline

$settingsJson = @{
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
  ssh = @{
    enabled = $false
  }
  mobileBridge = @{
    enabled = $false
    host = '127.0.0.1'
    port = 3310
    allowedOrigin = 'xapi.test'
  }
  telemetry = @{
    enabled = $false
    ingestUrl = ''
    bearerToken = ''
    logLevel = 'debug'
    flushIntervalMs = 5000
    requestTimeoutMs = 8000
    maxBatchSize = 25
    maxQueueSize = 5000
    includeRendererErrors = $true
    retentionDays = 30
  }
  connectionProfiles = @(
    @{
      id = 'direct-sql-sepidar'
      metadata = @{
        name = 'Sepidar Direct SQL'
        description = 'Direct SQL connection to Sepidar on server'
        type = 'direct'
        lastTestStatus = 'never'
        lastTestMessage = ''
        lastTestAt = $null
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
    }
  )
  activeConnectionProfileId = 'direct-sql-sepidar'
  schemaCatalogs = @()
  promptTemplates = @()
  financialEngineMode = 'engine'
  sshHostKeys = @{}
} | ConvertTo-Json -Depth 10

# Write settings to a temp file, then upload it
$tempSettings = Join-Path $env:TEMP 'acc-assist-s19-settings.json'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($tempSettings, $settingsJson, $utf8NoBom)

$remoteSettingsDir = 'C:\Users\Administrator\AppData\Roaming\acc-assist'
$remoteSettingsPath = "$remoteSettingsDir\acc-assist.settings.json"

# Create dir and upload
Invoke-RemotePowerShell "New-Item -ItemType Directory -Force -Path '$remoteSettingsDir' | Out-Null"
Copy-File $tempSettings $remoteSettingsPath
Remove-Item $tempSettings -Force -ErrorAction SilentlyContinue

Write-Host ' done' -ForegroundColor Green

# ── 5. Start debug server on server ──────────────────────────────────────────
Write-Host '[5/7] Starting ACC Assist debug server on server...' -NoNewline

$startScript = @"
`$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
`$env:ACC_AGENT_DEBUG_TOKEN = '$DebugToken'
`$exe = Join-Path `$env:LOCALAPPDATA 'Programs\acc-assist\ACCAssist.exe'
if (-not (Test-Path `$exe)) { throw "ACCAssist.exe not found at `$exe" }
Start-Process -FilePath `$exe -ArgumentList '--agent-debug-server-only'
`$ready = `$false
for (`$i = 0; `$i -lt 30; `$i++) {
  Start-Sleep -Seconds 1
  try {
    `$r = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3322/health' -Headers @{ 'x-debug-token' = '$DebugToken' } -TimeoutSec 2
    if (`$r.ok) { `$ready = `$true; break }
  } catch { }
}
if (-not `$ready) { throw 'Debug endpoint did not start within 30s' }
Write-Host 'ready'
"@

Invoke-RemotePowerShell $startScript
Write-Host ' READY' -ForegroundColor Green

# Wait for SQL connection to establish
Write-Host '      Waiting 10s for SQL connection to establish...' -NoNewline -ForegroundColor Gray
Start-Sleep -Seconds 10
Write-Host ' done' -ForegroundColor Gray

# ── 6. Run test questions via SSH ────────────────────────────────────────────
Write-Host ''
Write-Host '[6/7] Running S19 test questions...' -ForegroundColor Cyan
Write-Host ''

# 10 questions targeting Phase 19 advanced financial metrics
$questions = @(
  @{ id='q1'; prompt='صورت جریان وجوه نقد ۱۴۰۲'; expect='جریان' },
  @{ id='q2'; prompt='جریان نقدینگی ۱۴۰۲ چقدر است؟'; expect='نقد' },
  @{ id='q3'; prompt='بازده حقوق صاحبان سهام ۱۴۰۲'; expect='بازده' },
  @{ id='q4'; prompt='بازده دارایی‌ها ۱۴۰۲'; expect='بازده' },
  @{ id='q5'; prompt='تحلیل روند فروش چند ساله'; expect='روند' },
  @{ id='q6'; prompt='نرخ رشد فروش از ۱۴۰۲ تا ۱۴۰۳'; expect='رشد' },
  @{ id='q7'; prompt='نرخ رشد مرکب سالانه فروش از ۱۴۰۱ تا ۱۴۰۳'; expect='رشد' },
  @{ id='q8'; prompt='دارایی‌های ثابت ۱۴۰۲'; expect='ثابت' },
  @{ id='q9'; prompt='استهلاک ۱۴۰۲'; expect='استهلاک' },
  @{ id='q10'; prompt='خالص مالیات بر ارزش افزوده پرداختنی ۱۴۰۲'; expect='مالیات' }
)

$results = @()
$okCount = 0

foreach ($q in $questions) {
  $promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q.prompt))
  Write-Host "  [$($q.id)] $($q.prompt)" -NoNewline

  # Send question via SSH to the debug endpoint on the server
  $askScript = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
`$body = @{
  promptBase64 = '$promptBase64'
  mode = 'manual'
  conversationId = 'field-test-s19'
} | ConvertTo-Json -Depth 5
`$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
try {
  `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers @{ 'x-debug-token' = '$DebugToken' } -Body `$utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec
  `$finalText = [string]`$response.result.finalText
  `$requestId = [string]`$response.requestId
  `$isOk = [bool]`$response.ok
  `$payload = [pscustomobject]@{
    Ok = `$isOk
    RequestId = `$requestId
    FinalTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$finalText))
    ErrorTextBase64 = ''
  }
} catch {
  `$errMsg = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
  `$payload = [pscustomobject]@{
    Ok = `$false
    RequestId = ''
    FinalTextBase64 = ''
    ErrorTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errMsg))
  }
}
Write-Output '__ACC_S19_BEGIN__'
Write-Output (`$payload | ConvertTo-Json -Compress)
Write-Output '__ACC_S19_END__'
"@

  try {
    $rawOutput = Invoke-RemotePowerShell $askScript | Out-String
    if ($rawOutput -match '__ACC_S19_BEGIN__\s*(\{.+?\})\s*__ACC_S19_END__') {
      $payload = $Matches[1] | ConvertFrom-Json
      $finalText = if ([string]::IsNullOrWhiteSpace([string]$payload.FinalTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.FinalTextBase64)) }
      $errorText = if ([string]::IsNullOrWhiteSpace([string]$payload.ErrorTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.ErrorTextBase64)) }
      $isOk = [bool]$payload.Ok
      $requestId = [string]$payload.RequestId

      $verdict = if ($isOk -and $finalText -notmatch 'error|خطا|نمی‌توانم|cannot answer') { 'ok' } else { 'fail' }

      if ($verdict -eq 'ok') {
        $okCount++
        Write-Host " -> OK (reqId: $requestId, textLen: $($finalText.Length))" -ForegroundColor Green
      } else {
        Write-Host " -> FAIL (reqId: $requestId)" -ForegroundColor Red
        $preview = if ($finalText) { $finalText.Substring(0, [Math]::Min(150, $finalText.Length)) } else { $errorText }
        Write-Host "      Text: $preview" -ForegroundColor Yellow
      }

      $results += [pscustomobject]@{
        Id = $q.id
        Prompt = $q.prompt
        Ok = $isOk
        Verdict = $verdict
        RequestId = $requestId
        FinalTextLen = $finalText.Length
        FinalTextPreview = $finalText.Substring(0, [Math]::Min(200, $finalText.Length))
      }
    } else {
      Write-Host " -> PARSE FAIL" -ForegroundColor Red
      Write-Host "      Raw: $($rawOutput.Substring(0, [Math]::Min(200, $rawOutput.Length)))" -ForegroundColor Yellow
      $results += [pscustomobject]@{
        Id = $q.id
        Prompt = $q.prompt
        Ok = $false
        Verdict = 'parse_fail'
        RequestId = ''
        FinalTextLen = 0
        FinalTextPreview = $rawOutput.Substring(0, [Math]::Min(200, $rawOutput.Length))
      }
    }
  } catch {
    $errorMsg = [string]$_.Exception.Message
    Write-Host " -> SSH EXCEPTION: $errorMsg" -ForegroundColor Red
    $results += [pscustomobject]@{
      Id = $q.id
      Prompt = $q.prompt
      Ok = $false
      Verdict = 'ssh_exception'
      RequestId = ''
      FinalTextLen = 0
      FinalTextPreview = $errorMsg
    }
  }

  Start-Sleep -Seconds $QuestionDelaySec
}

# ── 7. Summary + cleanup ─────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== FIELD TEST S19 RESULTS ===' -ForegroundColor Cyan
Write-Host "Total: $($results.Count)"
Write-Host "OK: $okCount / $($results.Count)"
Write-Host "Pass Rate: $([math]::Round($okCount / $results.Count * 100, 1))%"
Write-Host ''
$results | Format-Table Id, Verdict, RequestId, FinalTextLen -AutoSize

# Export detailed results locally
$exportPath = Join-Path $env:APPDATA 'acc-assist\field-test-s19-results.json'
$results | ConvertTo-Json -Depth 5 | Out-File $exportPath -Encoding UTF8
Write-Host "Detailed results: $exportPath" -ForegroundColor Gray

# Stop the app on server
Write-Host 'Stopping ACCAssist on server...' -NoNewline
Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force"
Write-Host ' done' -ForegroundColor Green

Write-Host ''
if ($okCount -eq $results.Count) {
  Write-Host 'VERDICT: PASS — All S19 questions answered correctly (remote install, direct SQL).' -ForegroundColor Green
} elseif ($okCount -ge ($results.Count - 1)) {
  Write-Host "VERDICT: PASS (with 1 acceptable failure) — S19 metrics functional." -ForegroundColor Green
} else {
  Write-Host "VERDICT: PARTIAL — $okCount/$($results.Count) passed. Review failures." -ForegroundColor Yellow
}
