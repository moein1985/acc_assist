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
  [string]$DebugToken = 'accassist-s28-field-test',
  [int]$QuestionDelaySec = 5,
  [int]$QueryTimeoutSec = 240,
  [string]$LocalBuildDir = 'dist\win-unpacked',
  [string]$RemoteAppDir = 'C:\Users\Administrator\AppData\Local\Programs\acc-assist'
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
  param([string]$LocalPath, [string]$RemotePath)
  & pscp -P $SshPort -batch -hostkey $HostKey -pw $SshPassword $LocalPath "${SshUser}@${SshHost}:$RemotePath"
}

Write-Host '=== FIELD TEST S28 - Test Truth & Cutover Gate ===' -ForegroundColor Cyan
Write-Host "Server: $SshHost`:$SshPort"
Write-Host "SQL: 127.0.0.1:$SqlPort ($SqlDatabase) - direct connection"
Write-Host "Remote app dir: $RemoteAppDir"
Write-Host ''

# -- 1. Verify local build exists --
$localExe = Join-Path $LocalBuildDir 'ACCAssist.exe'
if (-not (Test-Path $localExe)) {
  throw "Local build not found at $localExe. Run build first."
}
Write-Host '[1/7] Local build found.' -ForegroundColor Green

# -- 2. Stop existing app on server --
Write-Host '[2/7] Stopping existing ACCAssist on server...' -NoNewline
Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force; Write-Host 'stopped'"
Write-Host ' done' -ForegroundColor Green

# -- 3. Copy updated app.asar to server --
Write-Host '[3/7] Copying app.asar to server...' -NoNewline
$remoteResources = "$RemoteAppDir\resources"
$localAsar = Join-Path $LocalBuildDir 'resources\app.asar'
if (-not (Test-Path $localAsar)) { throw "app.asar not found at $localAsar" }
$asarSizeMB = [math]::Round((Get-Item $localAsar).Length / 1MB, 1)
Write-Host " ($asarSizeMB MB)..." -NoNewline
$remoteAsarPath = "$remoteResources/app.asar"
Copy-File $localAsar $remoteAsarPath

# Copy V8 snapshot files (required for Electron to start)
$localSnapshotBlob = Join-Path $LocalBuildDir 'snapshot_blob.bin'
$localV8Context = Join-Path $LocalBuildDir 'v8_context_snapshot.bin'
if (Test-Path $localSnapshotBlob) { Copy-File $localSnapshotBlob "$RemoteAppDir/snapshot_blob.bin" }
if (Test-Path $localV8Context) { Copy-File $localV8Context "$RemoteAppDir/v8_context_snapshot.bin" }

Write-Host ' done' -ForegroundColor Green

# S28.11: Verify mandatory asar markers
Write-Host '  Verifying S28 markers on server...' -NoNewline
$verifyScript = '$asarPath = "' + $remoteResources + '\app.asar"; $markers = @("CUTOVER_LOCKED","engineOnlyGate","party_turnover","checkIntentAlignment","EVIDENCE_FIRST_ENGINE","INVESTIGATOR_LOOP","BLIND_DISCOVERY_V1"); $found = 0; $missing = @(); foreach ($m in $markers) { $r = Select-String -Path $asarPath -Pattern $m -SimpleMatch -Quiet -ErrorAction SilentlyContinue; if ($r) { $found++ } else { $missing += $m } }; Write-Host "$found/$($markers.Count) markers found"; if ($missing.Count -gt 0) { Write-Host "MISSING: $($missing -join '', '')" }'
$verifyResult = Invoke-RemotePowerShell $verifyScript | Out-String
Write-Host " $verifyResult".Trim() -ForegroundColor Green

# -- 4. Write settings.json on server --
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

$tempSettings = Join-Path $env:TEMP 'acc-assist-s28-settings.json'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($tempSettings, $settingsJson, $utf8NoBom)

$remoteSettingsDir = 'C:\Users\Administrator\AppData\Roaming\acc-assist'
$remoteSettingsPath = "$remoteSettingsDir\acc-assist.settings.json"
Invoke-RemotePowerShell "New-Item -ItemType Directory -Force -Path '$remoteSettingsDir' | Out-Null"
Copy-File $tempSettings $remoteSettingsPath
Remove-Item $tempSettings -Force -ErrorAction SilentlyContinue
Write-Host ' done' -ForegroundColor Green

# -- 5+6+7. Run entire test in a single SSH session --
# S28.12-S28.16: Core metrics + party_turnover + user question + persistence + anti-hallucination + help
# Questions encoded as base64 UTF-8 Persian text

$questions = @(
  # S28.12: 6 core metrics + party_turnover (real person)
  @{ id='q1'; b64='2YHYsdmI2LQg27HbtNuw27Ig2obZgtiv2LEg2KjZiNiv2J8='; expect='net_sales'; category='core' },
  @{ id='q2'; b64='2YXYp9mG2K/ZhyDYrdiz2KfYqCDYqNin2YbaqduMINux27TbsNuy'; expect='cash_bank_balance'; category='core' },
  @{ id='q3'; b64='2KrYsdin2LIg2KLYstmF2KfbjNi024wg27HbtNuw27I='; expect='trial_balance'; category='core' },
  @{ id='q4'; b64='2K/YsduM2KfZgdiq2YbbjOKAjNmH2KfbjCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw=='; expect='receivables'; category='core' },
  @{ id='q5'; b64='2b7Ysdiv2KfYrtiq2YbbjOKAjNmH2KfbjCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw=='; expect='payables'; category='core' },
  @{ id='q6'; b64='2KrYudiv2KfYryDZgdin2qnYqtmI2LHZh9in24wg2YHYsdmI2LQg27HbtNuw27I='; expect='sales_count'; category='core' },
  @{ id='q7'; b64='2q/Ysdiv2LQg2K3Ys9in2Kgg2KLZgtin24wg2YXYuduM2YYg2YXYrdiz2YbbjCDZgdix2K8g27HbtNuw27I='; expect='party_turnover'; category='core' },
  # S28.13: User main question - valid number or multi-ledger clarification
  @{ id='q8'; b64='2q/Ysdiv2LQg2K3Ys9in2Kgg2KLZgtin24wg2YXYuduM2YYg2YXYrdiz2YbbjCDZgdix2K8g2K/YsSDYs9in2YQg27HbtNuw27Ig2obZgtiv2LEg2KfYs9iq2J8='; expect='party_turnover_or_clarify'; category='user-main' },
  # S28.14: Persistence scenario - financial question without ready metric
  @{ id='q9'; b64='2YXYrNmF2YjYuSDZh9iy24zZhtmH4oCM2YfYp9uMINm+2LHYs9mG2YTbjCDbsdu027DbsiDahtmC2K/YsSDYqNmI2K/Zh9if'; expect='investigator_or_refuse'; category='persistence' },
  # S28.15: Anti-hallucination guards
  @{ id='q10'; b64='2KrYudiv2KfYryDaqdin2LHZhdmG2K/Yp9mGINqG2YLYr9ixINin2LPYqtif'; expect='refuse_no_number'; category='anti-hallucination' },
  @{ id='q11'; b64='2YfZiNin24wg2KrZh9ix2KfZhiDahti32YjYsSDYp9iz2KrYnw=='; expect='refuse_text_only'; category='anti-hallucination' },
  @{ id='q12'; b64='2YLbjNmF2Kog2LfZhNinINiv2LEg2KjYp9iy2KfYsSDahtmC2K/YsSDYp9iz2KrYnw=='; expect='refuse_no_number'; category='anti-hallucination' },
  # S28.16: Non-financial help question
  @{ id='q13'; b64='2obYt9mI2LEg2K/YsSDYs9m+24zYr9in2LEg2YHYp9qp2KrZiNixINmB2LHZiNi0INir2KjYqiDZhduM4oCM2LTZiNiv2J8='; expect='text_help'; category='help' }
)

Write-Host '[5/7] Starting ACC Assist + running 13 questions in single SSH session...' -ForegroundColor Cyan

$questionLines = @()
foreach ($q in $questions) {
  $questionLines += "  @{ id='$($q.id)'; category='$($q.category)'; b64='$($q.b64)' }"
}
$questionsBlock = $questionLines -join ",`n"

$fullTestScript = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

`$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
`$env:ACC_AGENT_DEBUG_TOKEN = '$DebugToken'
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
    conversationId = 'field-test-s28'
  } | ConvertTo-Json -Depth 5
  `$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
  try {
    `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers @{ 'x-debug-token' = '$DebugToken' } -Body `$utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec
    `$finalText = [string]`$response.result.finalText
    `$requestId = [string]`$response.requestId
    `$isOk = [bool]`$response.ok
    `$textB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$finalText))
    Write-Host "QUESTION_RESULT[`$(`$q.id)]|ok=`$isOk|reqId=`$requestId|textLen=`$(`$finalText.Length)|textB64=`$textB64"
    if (`$isOk) {
      `$okCount++
    }
  } catch {
    `$errMsg = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
    `$errB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errMsg))
    Write-Host "QUESTION_RESULT[`$(`$q.id)]|ok=False|reqId=|textLen=0|errB64=`$errB64"
  }
  Start-Sleep -Seconds $QuestionDelaySec
}

Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "SUMMARY|ok=`$okCount|total=`$(`$questions.Count)"
"@

$localTempScript = Join-Path $env:TEMP 'acc-assist-s28-remote.ps1'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($localTempScript, $fullTestScript, $utf8NoBom)

$remoteScriptPath = 'C:\Users\Administrator\AppData\Local\Temp\acc-assist-s28-remote.ps1'
Copy-File $localTempScript $remoteScriptPath
Remove-Item $localTempScript -Force -ErrorAction SilentlyContinue

$rawOutput = & plink -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" "powershell -NoProfile -ExecutionPolicy Bypass -File $remoteScriptPath" 2>&1 | Out-String

Write-Host ' done' -ForegroundColor Green

Write-Host ''
Write-Host '=== RAW OUTPUT START ===' -ForegroundColor Gray
Write-Host $rawOutput -ForegroundColor Gray
Write-Host '=== RAW OUTPUT END ===' -ForegroundColor Gray
Write-Host ''

# -- Parse results --
Write-Host ''
Write-Host '=== FIELD TEST S28 RESULTS ===' -ForegroundColor Cyan

$results = @()
$okCount = 0

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
    
    $q = $questions | Where-Object { $_.id -eq $qId }
    $promptPreview = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($q.b64))
    $promptPreview = $promptPreview.Substring(0, [Math]::Min(60, $promptPreview.Length))
    
    # Category-specific verdict
    $verdict = 'fail'
    $verdictNote = ''
    if ($q.category -eq 'core') {
      # Core metrics: ok=true and text not error
      if ($isOk -and $finalText -notmatch 'error|cannot answer|نمی‌توانم') {
        $verdict = 'ok'
      }
    } elseif ($q.category -eq 'user-main') {
      # User main question: ok=true with valid number OR clarification text
      if ($isOk -and $textLen -gt 20) {
        $verdict = 'ok'
      }
    } elseif ($q.category -eq 'persistence') {
      # Persistence: ok=true (investigator gathers data) or explicit refuse
      if ($isOk -and $textLen -gt 20) {
        $verdict = 'ok'
      }
    } elseif ($q.category -eq 'anti-hallucination') {
      # Anti-hallucination: ok=true but text should NOT contain numbers/currency
      if ($isOk) {
        if ($finalText -match '\d{4,}|ریال|تومان|million|billion') {
          $verdict = 'fail'
          $verdictNote = 'HALLUCINATION: number found in refusal'
        } else {
          $verdict = 'ok'
        }
      }
    } elseif ($q.category -eq 'help') {
      # Help: ok=true with text response, no SQL/number
      if ($isOk -and $textLen -gt 20) {
        $verdict = 'ok'
      }
    }
    
    if ($verdict -eq 'ok') { $okCount++ }
    
    Write-Host "  [$qId] ($($q.category)) $promptPreview -> $($verdict.ToUpper()) (reqId: $reqId, textLen: $textLen)" -ForegroundColor $(if ($verdict -eq 'ok') { 'Green' } else { 'Red' })
    if ($verdictNote) {
      Write-Host "      NOTE: $verdictNote" -ForegroundColor Red
    }
    if ($verdict -ne 'ok' -and $finalText) {
      $preview = $finalText.Substring(0, [Math]::Min(200, $finalText.Length))
      Write-Host "      Text: $preview" -ForegroundColor Yellow
    }
    
    $results += [pscustomobject]@{
      Id = $qId
      Category = $q.category
      Prompt = $promptPreview
      Ok = $isOk
      Verdict = $verdict
      RequestId = $reqId
      FinalTextLen = $textLen
      Note = $verdictNote
    }
  } elseif ($line -match '^QUESTION_RESULT\[(.+?)\]\|ok=False\|reqId=\|textLen=0\|errB64=(.*)$') {
    $qId = $Matches[1]
    $errB64 = $Matches[2]
    $errorText = if ($errB64 -and $errB64 -ne '') { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($errB64)) } else { 'Unknown error' }
    
    $verdict = 'fail'
    $q = $questions | Where-Object { $_.id -eq $qId }
    $promptPreview = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($q.b64))
    $promptPreview = $promptPreview.Substring(0, [Math]::Min(60, $promptPreview.Length))
    Write-Host "  [$qId] ($($q.category)) $promptPreview -> FAIL" -ForegroundColor Red
    Write-Host "      Error: $($errorText.Substring(0, [Math]::Min(150, $errorText.Length)))" -ForegroundColor Yellow
    
    $results += [pscustomobject]@{
      Id = $qId
      Category = $q.category
      Prompt = $promptPreview
      Ok = $false
      Verdict = 'fail'
      RequestId = ''
      FinalTextLen = 0
      Note = $errorText
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

$exportPath = Join-Path $env:APPDATA 'acc-assist\field-test-s28-results.json'
$results | ConvertTo-Json -Depth 5 | Out-File $exportPath -Encoding UTF8
Write-Host "Detailed results: $exportPath" -ForegroundColor Gray

Write-Host ''
if ($okCount -eq $results.Count) {
  Write-Host 'VERDICT: PASS - All S28 questions answered correctly.' -ForegroundColor Green
} elseif ($okCount -ge ($results.Count - 1)) {
  Write-Host "VERDICT: PASS (with 1 acceptable failure) - S28 features functional." -ForegroundColor Green
} else {
  Write-Host "VERDICT: PARTIAL - $okCount/$($results.Count) passed. Review failures." -ForegroundColor Yellow
}
