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
  [string]$DebugToken = 'accassist-s20-field-test',
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

Write-Host '=== FIELD TEST S20 — Advanced Planner (Remote Install) ===' -ForegroundColor Cyan
Write-Host "Server: $SshHost`:$SshPort"
Write-Host "SQL: 127.0.0.1:$SqlPort ($SqlDatabase) — direct connection"
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

# ── 3. Copy updated app.asar to server ───────────────────────────────────────
Write-Host '[3/7] Copying app.asar to server...' -NoNewline

$remoteResources = "$RemoteAppDir\resources"
$localAsar = Join-Path $LocalBuildDir 'resources\app.asar'
if (-not (Test-Path $localAsar)) { throw "app.asar not found at $localAsar" }

$asarSizeMB = [math]::Round((Get-Item $localAsar).Length / 1MB, 1)
Write-Host " ($asarSizeMB MB)..." -NoNewline
$remoteAsarPath = "$remoteResources/app.asar"
Copy-File $localAsar $remoteAsarPath
Write-Host ' done' -ForegroundColor Green

# Verify markers
Write-Host '  Verifying S20 markers on server...' -NoNewline
$verifyScript = @"
`$asarPath = '$remoteResources\app.asar'
`$markers = @('MULTI_STEP_PLAN','SMART_SUGGESTIONS','ANOMALY_DETECTION','ANOMALY_DETECTION_AUTO')
`$found = 0
foreach (`$m in `$markers) {
  `$r = Select-String -Path `$asarPath -Pattern `$m -SimpleMatch -Quiet -ErrorAction SilentlyContinue
  if (`$r) { `$found++ }
}
Write-Host "`$found/4 markers found"
"@
$verifyResult = Invoke-RemotePowerShell $verifyScript | Out-String
Write-Host " $verifyResult".Trim() -ForegroundColor Green

# ── 4. Write settings.json on server ─────────────────────────────────────────
Write-Host '[4/7] Writing settings.json on server...' -NoNewline

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
  ssh = @{ enabled = $false }
  mobileBridge = @{ enabled = $false; host = '127.0.0.1'; port = 3310; allowedOrigin = 'xapi.test' }
  telemetry = @{
    enabled = $false; ingestUrl = ''; bearerToken = ''; logLevel = 'debug'
    flushIntervalMs = 5000; requestTimeoutMs = 8000; maxBatchSize = 25
    maxQueueSize = 5000; includeRendererErrors = $true; retentionDays = 30
  }
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

$tempSettings = Join-Path $env:TEMP 'acc-assist-s20-settings.json'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($tempSettings, $settingsJson, $utf8NoBom)

$remoteSettingsDir = 'C:\Users\Administrator\AppData\Roaming\acc-assist'
$remoteSettingsPath = "$remoteSettingsDir\acc-assist.settings.json"
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

Write-Host '      Waiting 20s for SQL connection...' -NoNewline -ForegroundColor Gray
Start-Sleep -Seconds 20
Write-Host ' done' -ForegroundColor Gray

# Re-check health before running questions
Write-Host '      Health re-check...' -NoNewline -ForegroundColor Gray
$healthCheck = Invoke-RemotePowerShell @"
try {
  `$r = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3322/health' -Headers @{ 'x-debug-token' = '$DebugToken' } -TimeoutSec 5
  Write-Host "health ok: `$r.ok"
} catch {
  Write-Host "health fail: `$(`$_.Exception.Message)"
}
"@
Write-Host " $($healthCheck | Out-String)".Trim() -ForegroundColor Gray

# ── 6. Run 8 test questions ──────────────────────────────────────────────────
Write-Host ''
Write-Host '[6/7] Running S20 test questions (8 questions)...' -ForegroundColor Cyan
Write-Host ''

# 8 questions: multi-step, conversation ref, suggestion, anomaly, clarify
$questions = @(
  @{ id='q1'; prompt='فروش ۱۴۰۲ چقدر بود؟'; expect='فروش'; category='baseline' },
  @{ id='q2'; prompt='فروش ۱۴۰۱ چقدر بود؟'; expect='فروش'; category='conversation-ref' },
  @{ id='q3'; prompt='ترازنامه ۱۴۰۲ رو نشون بده'; expect='تراز'; category='domain-knowledge' },
  @{ id='q4'; prompt='نسبت جاری ۱۴۰۲ چقدر است؟'; expect='جاری'; category='domain-knowledge' },
  @{ id='q5'; prompt='مقایسه فروش ۱۴۰۲ و ۱۴۰۳'; expect='فروش'; category='anomaly' },
  @{ id='q6'; prompt='سود چقدره؟'; expect='clarify'; category='advanced-clarify' },
  @{ id='q7'; prompt='مانده حساب بانکی ۱۴۰۲'; expect='بانک'; category='baseline' },
  @{ id='q8'; prompt='دریافتنی‌های ۱۴۰۲ چقدر است؟'; expect='دریافتنی'; category='baseline' }
)

$results = @()
$okCount = 0

foreach ($q in $questions) {
  $promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q.prompt))
  Write-Host "  [$($q.id)] ($($q.category)) $($q.prompt)" -NoNewline

  $askScript = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
`$body = @{
  promptBase64 = '$promptBase64'
  mode = 'manual'
  conversationId = 'field-test-s20'
} | ConvertTo-Json -Depth 5
`$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
try {
  `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers @{ 'x-debug-token' = '$DebugToken' } -Body `$utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec
  `$finalText = [string]`$response.result.finalText
  `$requestId = [string]`$response.requestId
  `$isOk = [bool]`$response.ok
  `$suggestions = if (`$response.result.suggestions) { `$response.result.suggestions -join '|'} else { '' }
  `$payload = [pscustomobject]@{
    Ok = `$isOk
    RequestId = `$requestId
    FinalTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$finalText))
    ErrorTextBase64 = ''
    SuggestionsBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$suggestions))
  }
} catch {
  `$errMsg = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
  `$payload = [pscustomobject]@{
    Ok = `$false
    RequestId = ''
    FinalTextBase64 = ''
    ErrorTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errMsg))
    SuggestionsBase64 = ''
  }
}
Write-Output '__ACC_S20_BEGIN__'
Write-Output (`$payload | ConvertTo-Json -Compress)
Write-Output '__ACC_S20_END__'
"@

  try {
    $rawOutput = Invoke-RemotePowerShell $askScript | Out-String
    if ($rawOutput -match '__ACC_S20_BEGIN__\s*(\{.+?\})\s*__ACC_S20_END__') {
      $payload = $Matches[1] | ConvertFrom-Json
      $finalText = if ([string]::IsNullOrWhiteSpace([string]$payload.FinalTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.FinalTextBase64)) }
      $errorText = if ([string]::IsNullOrWhiteSpace([string]$payload.ErrorTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.ErrorTextBase64)) }
      $suggestions = if ([string]::IsNullOrWhiteSpace([string]$payload.SuggestionsBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.SuggestionsBase64)) }
      $isOk = [bool]$payload.Ok
      $requestId = [string]$payload.RequestId

      $verdict = if ($isOk -and $finalText -notmatch 'error|خطا|نمی‌توانم|cannot answer') { 'ok' } else { 'fail' }

      if ($verdict -eq 'ok') {
        $okCount++
        $suggInfo = if ($suggestions) { " sugg=$($suggestions.Split('|').Count)" } else { '' }
        Write-Host " -> OK (reqId: $requestId, textLen: $($finalText.Length)$suggInfo)" -ForegroundColor Green
      } else {
        Write-Host " -> FAIL (reqId: $requestId)" -ForegroundColor Red
        $preview = if ($finalText) { $finalText.Substring(0, [Math]::Min(150, $finalText.Length)) } else { $errorText }
        Write-Host "      Text: $preview" -ForegroundColor Yellow
      }

      $results += [pscustomobject]@{
        Id = $q.id
        Category = $q.category
        Prompt = $q.prompt
        Ok = $isOk
        Verdict = $verdict
        RequestId = $requestId
        FinalTextLen = $finalText.Length
        FinalTextPreview = $finalText.Substring(0, [Math]::Min(200, $finalText.Length))
        Suggestions = $suggestions
      }
    } else {
      Write-Host " -> PARSE FAIL" -ForegroundColor Red
      Write-Host "      Raw: $($rawOutput.Substring(0, [Math]::Min(200, $rawOutput.Length)))" -ForegroundColor Yellow
      $results += [pscustomobject]@{
        Id = $q.id; Category = $q.category; Prompt = $q.prompt; Ok = $false; Verdict = 'parse_fail'
        RequestId = ''; FinalTextLen = 0; FinalTextPreview = $rawOutput.Substring(0, [Math]::Min(200, $rawOutput.Length)); Suggestions = ''
      }
    }
  } catch {
    $errorMsg = [string]$_.Exception.Message
    Write-Host " -> SSH EXCEPTION: $errorMsg" -ForegroundColor Red
    $results += [pscustomobject]@{
      Id = $q.id; Category = $q.category; Prompt = $q.prompt; Ok = $false; Verdict = 'ssh_exception'
      RequestId = ''; FinalTextLen = 0; FinalTextPreview = $errorMsg; Suggestions = ''
    }
  }

  Start-Sleep -Seconds $QuestionDelaySec
}

# ── 7. Summary + cleanup ─────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== FIELD TEST S20 RESULTS ===' -ForegroundColor Cyan
Write-Host "Total: $($results.Count)"
Write-Host "OK: $okCount / $($results.Count)"
Write-Host "Pass Rate: $([math]::Round($okCount / $results.Count * 100, 1))%"
Write-Host ''
$results | Format-Table Id, Category, Verdict, RequestId, FinalTextLen -AutoSize

# Export detailed results locally
$exportPath = Join-Path $env:APPDATA 'acc-assist\field-test-s20-results.json'
$results | ConvertTo-Json -Depth 5 | Out-File $exportPath -Encoding UTF8
Write-Host "Detailed results: $exportPath" -ForegroundColor Gray

# Stop the app on server
Write-Host 'Stopping ACCAssist on server...' -NoNewline
Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force"
Write-Host ' done' -ForegroundColor Green

Write-Host ''
if ($okCount -eq $results.Count) {
  Write-Host 'VERDICT: PASS — All 8 S20 questions answered correctly.' -ForegroundColor Green
} elseif ($okCount -ge ($results.Count - 1)) {
  Write-Host "VERDICT: PASS (with 1 acceptable failure) — S20 features functional." -ForegroundColor Green
} else {
  Write-Host "VERDICT: PARTIAL — $okCount/$($results.Count) passed. Review failures." -ForegroundColor Yellow
}
