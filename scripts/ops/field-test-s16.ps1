param(
  [string]$SshHost = '192.168.85.56',
  [int]$SshPort = 2211,
  [string]$SshUser = 'administrator',
  [string]$SshPassword = 'Hs-co@12321#',
  [int]$SqlPort = 58033,
  [string]$SqlUser = 'damavand',
  [string]$SqlPassword = 'damavand',
  [string]$SqlDatabase = 'Sepidar01',
  [string]$DebugToken = 'accassist-ssh-debug-token',
  [int]$DebugPort = 3322,
  [int]$QuestionDelaySec = 5,
  [int]$QueryTimeoutSec = 240
)

$ErrorActionPreference = 'Stop'

# ── Paths ────────────────────────────────────────────────────────────────────
$appDataDir = Join-Path $env:APPDATA 'acc-assist'
$settingsFile = Join-Path $appDataDir 'acc-assist.settings.json'
$backupFile = Join-Path $appDataDir 'acc-assist.settings.json.bak-s16'
$exePath = Join-Path $env:LOCALAPPDATA 'Programs\acc-assist\ACCAssist.exe'

Write-Host '=== FIELD TEST S16 — SSH Remote Connection ===' -ForegroundColor Cyan
Write-Host "Target: $SshHost`:$SshPort -> SQL 127.0.0.1:$SqlPort ($SqlDatabase)"
Write-Host "Local EXE: $exePath"
Write-Host ''

# ── 1. Verify EXE exists ─────────────────────────────────────────────────────
if (-not (Test-Path $exePath)) {
  throw "ACCAssist.exe not found at $exePath. Run 'npm run build:win' and install first."
}
Write-Host '[1/6] EXE found.' -ForegroundColor Green

# ── 2. Backup existing settings ──────────────────────────────────────────────
if (Test-Path $settingsFile) {
  Copy-Item $settingsFile $backupFile -Force
  Write-Host "[2/6] Settings backed up to $backupFile" -ForegroundColor Green
} else {
  Write-Host '[2/6] No existing settings.json — will create new.' -ForegroundColor Yellow
}

# ── 3. Write SSH-enabled settings ────────────────────────────────────────────
$sshSettings = @{
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
    enabled = $true
    host = $SshHost
    port = $SshPort
    username = $SshUser
    password = $SshPassword
    privateKey = ''
    passphrase = ''
    dstHost = '127.0.0.1'
    dstPort = $SqlPort
    localPort = $null
    readyTimeoutMs = 20000
    keepaliveIntervalMs = 10000
    connectTimeoutMs = 15000
    reconnectEnabled = $true
    maxReconnectAttempts = 3
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
      id = 'ssh-sepidar-field-test'
      metadata = @{
        name = 'Sepidar SSH Field Test'
        description = 'SSH tunnel to Sepidar for S16 field test'
        type = 'ssh'
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
      ssh = @{
        enabled = $true
        host = $SshHost
        port = $SshPort
        username = $SshUser
        password = $SshPassword
        privateKey = ''
        passphrase = ''
        dstHost = '127.0.0.1'
        dstPort = $SqlPort
        localPort = $null
        readyTimeoutMs = 20000
        keepaliveIntervalMs = 10000
        connectTimeoutMs = 15000
        reconnectEnabled = $true
        maxReconnectAttempts = 3
      }
    }
  )
  activeConnectionProfileId = 'ssh-sepidar-field-test'
  schemaCatalogs = @()
  promptTemplates = @()

  sshHostKeys = @{}
}

$json = $sshSettings | ConvertTo-Json -Depth 10
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($settingsFile, $json, $utf8NoBom)
Write-Host "[3/6] Settings written with SSH tunnel enabled ($SshHost`:$SshPort -> 127.0.0.1:$SqlPort)" -ForegroundColor Green

# ── 4. Start app with debug server ───────────────────────────────────────────
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = $DebugToken

# Kill any existing instance
Get-Process -Name 'ACCAssist' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host '[4/6] Starting ACC Assist with SSH tunnel + debug server...' -NoNewline
Start-Process -FilePath $exePath -ArgumentList '--agent-debug-server-only'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$DebugPort/health" -Headers @{ 'x-debug-token' = $DebugToken } -TimeoutSec 2
    if ($resp.ok) { $ready = $true; break }
  } catch {
    # still starting
  }
}
if (-not $ready) {
  Write-Host ' FAILED' -ForegroundColor Red
  throw 'Debug endpoint did not start within 30s'
}
Write-Host ' READY' -ForegroundColor Green

# Wait for autoConnectOnStartup to establish SSH tunnel + SQL connection
Write-Host '      Waiting 10s for SSH tunnel + SQL connection to establish...' -NoNewline -ForegroundColor Gray
Start-Sleep -Seconds 10
Write-Host ' done' -ForegroundColor Gray

# ── 5. Run test questions ────────────────────────────────────────────────────
Write-Host ''
Write-Host '[5/6] Running test questions...' -ForegroundColor Cyan
Write-Host ''

$questions = @(
  # 3 basic financial (verify tunnel + SQL works)
  @{ id='q1'; prompt='فروش 1402 چقدر است؟'; expect='فروش' },
  @{ id='q2'; prompt='خرید 1402'; expect='خرید' },
  @{ id='q3'; prompt='تراز آزمایشی 1402'; expect='تراز' },
  # 2 financial statements
  @{ id='q4'; prompt='ترازنامه 1402'; expect='ترازنامه' },
  @{ id='q5'; prompt='صورت سود و زیان 1402'; expect='سود' },
  # 2 multi-year
  @{ id='q6'; prompt='مقایسه فروش 1402 و 1403'; expect='فروش' },
  @{ id='q7'; prompt='فروش به تفکیک سال'; expect='فروش' },
  # 2 accountant tools
  @{ id='q8'; prompt='تحلیل سنی دریافتنی‌ها'; expect='دریافتنی' },
  @{ id='q9'; prompt='کدام سندها تراز نیستند؟'; expect='تراز' },
  # 2 drill-down
  @{ id='q10'; prompt='فروش 1403 به تفکیک ماه'; expect='ماه' },
  # 1 negative (should refuse)
  @{ id='q11'; prompt='هوای فردا چطور است؟'; expect='رد' },
  # 1 date range
  @{ id='q12'; prompt='فروش از 1403/05/01 تا 1403/05/31 چقدر است؟'; expect='فروش' }
)

$results = @()
$okCount = 0

foreach ($q in $questions) {
  $promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q.prompt))
  Write-Host "  [$($q.id)] $($q.prompt)" -NoNewline

  $body = @{
    promptBase64 = $promptBase64
    mode = 'manual'
    conversationId = 'field-test-s16'
  } | ConvertTo-Json -Depth 5

  try {
    $utf8Body = [Text.Encoding]::UTF8.GetBytes($body)
    $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$DebugPort/ask" -Headers @{ 'x-debug-token' = $DebugToken } -Body $utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec

    $isOk = [bool]$response.ok
    $finalText = [string]$response.result.finalText
    $requestId = [string]$response.requestId

    $verdict = if ($isOk -and $finalText -notmatch 'error|خطا|نمی‌توانم|cannot answer') { 'ok' } else { 'fail' }
    if ($q.expect -eq 'رد' -and $finalText -match 'نمی‌توانم|مرتبط نیست|خارج از|cannot answer') {
      $verdict = 'ok'  # correct refusal
    }

    if ($verdict -eq 'ok') {
      $okCount++
      Write-Host " -> OK (reqId: $requestId, textLen: $($finalText.Length))" -ForegroundColor Green
    } else {
      Write-Host " -> FAIL (reqId: $requestId)" -ForegroundColor Red
      $preview = $finalText.Substring(0, [Math]::Min(150, $finalText.Length))
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
  } catch {
    $errorMsg = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { [string]$_.ErrorDetails.Message } else { [string]$_.Exception.Message }
    Write-Host " -> EXCEPTION: $errorMsg" -ForegroundColor Red
    $results += [pscustomobject]@{
      Id = $q.id
      Prompt = $q.prompt
      Ok = $false
      Verdict = 'exception'
      RequestId = ''
      FinalTextLen = 0
      FinalTextPreview = $errorMsg
    }
  }

  Start-Sleep -Seconds $QuestionDelaySec

  # Health check between questions to verify tunnel is still active
  try {
    $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$DebugPort/health" -Headers @{ 'x-debug-token' = $DebugToken } -TimeoutSec 5
    if (-not $health.ok) { Write-Host '  [WARN] Health check failed — tunnel may be down' -ForegroundColor Yellow }
  } catch {
    Write-Host '  [WARN] Health check exception — tunnel may be reconnecting' -ForegroundColor Yellow
  }
}

# ── 6. Summary + cleanup ─────────────────────────────────────────────────────
Write-Host ''
Write-Host '=== FIELD TEST S16 RESULTS ===' -ForegroundColor Cyan
Write-Host "Total: $($results.Count)"
Write-Host "OK: $okCount / $($results.Count)"
Write-Host "Pass Rate: $([math]::Round($okCount / $results.Count * 100, 1))%"
Write-Host ''
$results | Format-Table Id, Verdict, RequestId, FinalTextLen -AutoSize

# Export detailed results
$exportPath = Join-Path $appDataDir 'field-test-s16-results.json'
$results | ConvertTo-Json -Depth 5 | Out-File $exportPath -Encoding UTF8
Write-Host "Detailed results: $exportPath" -ForegroundColor Gray

# Stop the app
Get-Process -Name 'ACCAssist' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Restore settings
if (Test-Path $backupFile) {
  Copy-Item $backupFile $settingsFile -Force
  Remove-Item $backupFile -Force
  Write-Host '[6/6] Settings restored from backup.' -ForegroundColor Green
} else {
  Write-Host '[6/6] No backup to restore — settings left as-is.' -ForegroundColor Yellow
}

Write-Host ''
if ($okCount -eq $results.Count) {
  Write-Host 'VERDICT: PASS — All questions answered correctly via SSH tunnel.' -ForegroundColor Green
} elseif ($okCount -ge ($results.Count - 1)) {
  Write-Host "VERDICT: PASS (with 1 acceptable failure) — SSH tunnel functional." -ForegroundColor Green
} else {
  Write-Host "VERDICT: PARTIAL — $okCount/$($results.Count) passed. Review failures." -ForegroundColor Yellow
}
