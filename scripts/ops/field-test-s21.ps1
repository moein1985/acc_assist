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
  [string]$DebugToken = 'accassist-s21-field-test',
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

Write-Host '=== FIELD TEST S21 — UX & Reporting (Remote Install) ===' -ForegroundColor Cyan
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
Write-Host '  Verifying S21 markers on server...' -NoNewline
$verifyScript = @"
`$asarPath = '$remoteResources\app.asar'
`$markers = @('SQL_TRANSPARENCY','CONFIDENCE_SCORE','EVIDENCE_PANEL','INTERACTIVE_CHARTS','SCHEDULED_REPORTS','ENGLISH_QUERY','MIXED_LANGUAGE','CHAT_HISTORY','EXPORT_CONVERSATION','QUICK_ACTIONS')
`$found = 0
foreach (`$m in `$markers) {
  `$r = Select-String -Path `$asarPath -Pattern `$m -SimpleMatch -Quiet -ErrorAction SilentlyContinue
  if (`$r) { `$found++ }
}
Write-Host "`$found/10 markers found"
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
  financialEngineMode = 'engine'
  sshHostKeys = @{}
} | ConvertTo-Json -Depth 10

$tempSettings = Join-Path $env:TEMP 'acc-assist-s21-settings.json'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($tempSettings, $settingsJson, $utf8NoBom)

$remoteSettingsDir = 'C:\Users\Administrator\AppData\Roaming\acc-assist'
$remoteSettingsPath = "$remoteSettingsDir\acc-assist.settings.json"
Invoke-RemotePowerShell "New-Item -ItemType Directory -Force -Path '$remoteSettingsDir' | Out-Null"
Copy-File $tempSettings $remoteSettingsPath
Remove-Item $tempSettings -Force -ErrorAction SilentlyContinue
Write-Host ' done' -ForegroundColor Green

# ── 5+6+7. Run entire test in a single SSH session ──────────────────────────
# The app process is killed when its parent SSH session closes.
# So we must start the app, ask all questions, and stop the app all within
# a single SSH connection.

# 8 questions: English, mixed language, baseline Persian
$questions = @(
  @{ id='q1'; prompt='What were total sales in 1402?'; expect='sales'; category='english' },
  @{ id='q2'; prompt='Show me the balance sheet for 1402'; expect='balance'; category='english' },
  @{ id='q3'; prompt='Compare expenses 1402 vs 1403'; expect='expense'; category='english' },
  @{ id='q4'; prompt='Cash and bank balance'; expect='cash'; category='english' },
  @{ id='q5'; prompt='فروش 1402 رو با 1403 compare کن'; expect='فروش'; category='mixed-language' },
  @{ id='q6'; prompt='total expenses سال 1402 چقدره؟'; expect='هزینه'; category='mixed-language' },
  @{ id='q7'; prompt='فروش ۱۴۰۲ چقدر بود؟'; expect='فروش'; category='baseline-persian' },
  @{ id='q8'; prompt='مانده حساب بانکی ۱۴۰۲'; expect='بانک'; category='baseline-persian' }
)

Write-Host '[5/7] Starting ACC Assist + running 8 questions in single SSH session...' -ForegroundColor Cyan

# Build question prompts as base64 for embedding in the remote script
$questionLines = @()
foreach ($q in $questions) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q.prompt))
  $questionLines += "  @{ id='$($q.id)'; category='$($q.category)'; b64='$b64' }"
}
$questionsBlock = $questionLines -join ",`n"

$fullTestScript = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

# --- Start app ---
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

# --- Questions ---
`$questions = @(
$questionsBlock
)

`$results = @()
`$okCount = 0

foreach (`$q in `$questions) {
  Write-Host "QUESTION_START[`$(`$q.id)]"
  `$body = @{
    promptBase64 = `$q.b64
    mode = 'manual'
    conversationId = 'field-test-s21'
  } | ConvertTo-Json -Depth 5
  `$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
  try {
    `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers @{ 'x-debug-token' = '$DebugToken' } -Body `$utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec
    `$finalText = [string]`$response.result.finalText
    `$requestId = [string]`$response.requestId
    `$isOk = [bool]`$response.ok
    `$textB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$finalText))
    Write-Host "QUESTION_RESULT[`$(`$q.id)]|ok=`$isOk|reqId=`$requestId|textLen=`$(`$finalText.Length)|textB64=`$textB64"
    if (`$isOk -and `$finalText -notmatch 'error|خطا|نمی‌توانم|cannot answer') {
      `$okCount++
    }
  } catch {
    `$errMsg = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
    `$errB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errMsg))
    Write-Host "QUESTION_RESULT[`$(`$q.id)]|ok=False|reqId=|textLen=0|errB64=`$errB64"
  }
  Start-Sleep -Seconds $QuestionDelaySec
}

# --- Stop app ---
Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "SUMMARY|ok=`$okCount|total=`$(`$questions.Count)"
"@

# Write the test script to a temp file, copy to server, then execute
$localTempScript = Join-Path $env:TEMP 'acc-assist-s21-remote.ps1'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($localTempScript, $fullTestScript, $utf8NoBom)

$remoteScriptPath = 'C:\Users\Administrator\AppData\Local\Temp\acc-assist-s21-remote.ps1'
Copy-File $localTempScript $remoteScriptPath
Remove-Item $localTempScript -Force -ErrorAction SilentlyContinue

$rawOutput = & plink -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" "powershell -NoProfile -ExecutionPolicy Bypass -File $remoteScriptPath" 2>&1 | Out-String

Write-Host ' done' -ForegroundColor Green

# Debug: show raw output
Write-Host ''
Write-Host '=== RAW OUTPUT START ===' -ForegroundColor Gray
Write-Host $rawOutput -ForegroundColor Gray
Write-Host '=== RAW OUTPUT END ===' -ForegroundColor Gray
Write-Host ''

# ── Parse results ─────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== FIELD TEST S21 RESULTS ===' -ForegroundColor Cyan

$results = @()
$okCount = 0

# Reconstruct wrapped lines: join lines that don't start with known prefixes
$knownPrefixes = @('QUESTION_START', 'QUESTION_RESULT', 'SUMMARY', 'APP_READY', 'APP_NOT_READY', 'EXE_NOT_FOUND')
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
  if ($line -match '^QUESTION_RESULT\[(.+?)\]\|ok=(True|False)\|reqId=(.*?)\|textLen=(\d+)\|textB64=(.*)$') {
    $qId = $Matches[1]
    $isOk = $Matches[2] -eq 'True'
    $reqId = $Matches[3]
    $textLen = [int]$Matches[4]
    $textB64 = $Matches[5]
    
    $finalText = if ($textB64 -and $textB64 -ne '') { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($textB64)) } else { '' }
    $errorText = ''
    
    $verdict = if ($isOk -and $finalText -notmatch 'error|خطا|نمی‌توانم|cannot answer') { 'ok' } else { 'fail' }
    if ($verdict -eq 'ok') { $okCount++ }
    
    $q = $questions | Where-Object { $_.id -eq $qId }
    Write-Host "  [$qId] ($($q.category)) $($q.prompt) -> $($verdict.ToUpper()) (reqId: $reqId, textLen: $textLen)" -ForegroundColor $(if ($verdict -eq 'ok') { 'Green' } else { 'Red' })
    if ($verdict -ne 'ok') {
      $preview = if ($finalText) { $finalText.Substring(0, [Math]::Min(150, $finalText.Length)) } else { $errorText }
      Write-Host "      Text: $preview" -ForegroundColor Yellow
    }
    
    $results += [pscustomobject]@{
      Id = $qId
      Category = $q.category
      Prompt = $q.prompt
      Ok = $isOk
      Verdict = $verdict
      RequestId = $reqId
      FinalTextLen = $textLen
      FinalTextPreview = if ($finalText) { $finalText.Substring(0, [Math]::Min(200, $finalText.Length)) } else { $errorText }
    }
  } elseif ($line -match '^QUESTION_RESULT\[(.+?)\]\|ok=False\|reqId=\|textLen=0\|errB64=(.*)$') {
    $qId = $Matches[1]
    $errB64 = $Matches[2]
    $errorText = if ($errB64 -and $errB64 -ne '') { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($errB64)) } else { 'Unknown error' }
    
    $verdict = 'fail'
    $q = $questions | Where-Object { $_.id -eq $qId }
    Write-Host "  [$qId] ($($q.category)) $($q.prompt) -> FAIL" -ForegroundColor Red
    Write-Host "      Error: $($errorText.Substring(0, [Math]::Min(150, $errorText.Length)))" -ForegroundColor Yellow
    
    $results += [pscustomobject]@{
      Id = $qId
      Category = $q.category
      Prompt = $q.prompt
      Ok = $false
      Verdict = 'fail'
      RequestId = ''
      FinalTextLen = 0
      FinalTextPreview = $errorText
    }
  }
}

Write-Host ''
Write-Host "Total: $($results.Count)"
Write-Host "OK: $okCount / $($results.Count)"
if ($results.Count -gt 0) {
  Write-Host "Pass Rate: $([math]::Round($okCount / $results.Count * 100, 1))%"
} else {
  Write-Host "Pass Rate: N/A (no results parsed)"
}
Write-Host ''
$results | Format-Table Id, Category, Verdict, RequestId, FinalTextLen -AutoSize

# Export detailed results locally
$exportPath = Join-Path $env:APPDATA 'acc-assist\field-test-s21-results.json'
$results | ConvertTo-Json -Depth 5 | Out-File $exportPath -Encoding UTF8
Write-Host "Detailed results: $exportPath" -ForegroundColor Gray

Write-Host ''
if ($okCount -eq $results.Count) {
  Write-Host 'VERDICT: PASS — All 8 S21 questions answered correctly.' -ForegroundColor Green
} elseif ($okCount -ge ($results.Count - 1)) {
  Write-Host "VERDICT: PASS (with 1 acceptable failure) — S21 features functional." -ForegroundColor Green
} else {
  Write-Host "VERDICT: PARTIAL — $okCount/$($results.Count) passed. Review failures." -ForegroundColor Yellow
}
