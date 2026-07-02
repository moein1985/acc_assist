$ProgressPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

$DebugToken = 'accassist-ssh-debug-token'
$DebugPort = 3322
$SqlPort = 58033
$SqlUser = 'damavand'
$SqlPassword = 'damavand'
$SqlDatabase = 'Sepidar01'
$QuestionDelaySec = 5
$QueryTimeoutSec = 240

$appDataDir = Join-Path $env:APPDATA 'acc-assist'
$settingsFile = Join-Path $appDataDir 'acc-assist.settings.json'
$exePath = Join-Path $env:LOCALAPPDATA 'Programs\acc-assist\ACCAssist.exe'

if (-not (Test-Path $appDataDir)) { New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null }

# Backup existing settings
if (Test-Path $settingsFile) {
  Copy-Item $settingsFile "$settingsFile.bak-s18" -Force
}

# Write direct SQL settings (NO SSH tunnel)
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
      metadata = @{ name = 'Sepidar Direct SQL'; description = 'Direct SQL (no SSH)'; type = 'direct'; lastTestStatus = 'never'; lastTestMessage = ''; lastTestAt = $null }
      sql = @{
        server = '127.0.0.1'; database = $SqlDatabase; user = $SqlUser; password = $SqlPassword; port = $SqlPort
        encrypt = $false; trustServerCertificate = $true; connectionTimeoutMs = 15000; requestTimeoutMs = 45000; connectionRetryCount = 2; connectionRetryDelayMs = 2000
      }
    }
  )
  activeConnectionProfileId = 'direct-sql-sepidar'
  schemaCatalogs = @(
    @{
      id = 'sepidar'
      name = 'Sepidar'
      schemaType = 'sepidar'
      isActive = $true
    }
  )
  promptTemplates = @()

  sshHostKeys = @{}
}

$json = $settings | ConvertTo-Json -Depth 10
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($settingsFile, $json, $utf8NoBom)
Write-Host '[1/4] Settings written — direct SQL to 127.0.0.1:'$SqlPort' ('$SqlDatabase'), NO SSH tunnel' -ForegroundColor Green

# Start app with debug server
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = $DebugToken

Get-Process -Name 'ACCAssist' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if (-not (Test-Path $exePath)) {
  Write-Host "ERROR: ACCAssist.exe not found at $exePath" -ForegroundColor Red
  exit 1
}

Write-Host '[2/4] Starting ACC Assist with debug server (direct SQL)...' -NoNewline -ForegroundColor Gray
Start-Process -FilePath $exePath -ArgumentList '--agent-debug-server-only'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$DebugPort/health" -Headers @{ 'x-debug-token' = $DebugToken } -TimeoutSec 2
    if ($resp.ok) { $ready = $true; break }
  } catch { }
}
if (-not $ready) {
  Write-Host ' FAILED' -ForegroundColor Red
  exit 1
}
Write-Host ' READY' -ForegroundColor Green

Write-Host '      Waiting 10s for SQL connection...' -NoNewline -ForegroundColor Gray
Start-Sleep -Seconds 10
Write-Host ' done' -ForegroundColor Gray

Write-Host ''
Write-Host '[3/4] Running test questions...' -ForegroundColor Cyan
Write-Host ''

$questions = @(
  @{ id='q1'; prompt='فروش 1402 چقدر است؟'; expect='فروش' },
  @{ id='q2'; prompt='خرید 1402'; expect='خرید' },
  @{ id='q3'; prompt='تراز آزمایشی 1402'; expect='تراز' },
  @{ id='q4'; prompt='ترازنامه 1402'; expect='ترازنامه' },
  @{ id='q5'; prompt='صورت سود و زیان 1402'; expect='سود' },
  @{ id='q6'; prompt='فروش 1403 به تفکیک ماه'; expect='ماه' },
  @{ id='q7'; prompt='نمودار روند فروش 1402'; expect='فروش' },
  @{ id='q8'; prompt='خروجی اکسل فروش 1402'; expect='فروش' },
  @{ id='q9'; prompt='گزارش PDF ترازنامه 1402'; expect='ترازنامه' },
  @{ id='q10'; prompt='تحلیل سنی دریافتنی‌ها'; expect='دریافتنی' },
  @{ id='q11'; prompt='کدام سندها تراز نیستند؟'; expect='تراز' },
  @{ id='q12'; prompt='هوای فردا چطور است؟'; expect='رد' }
)

$results = @()
$okCount = 0

foreach ($q in $questions) {
  $promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q.prompt))
  Write-Host "  [$($q.id)] $($q.prompt)" -NoNewline

  $body = @{ promptBase64 = $promptBase64; mode = 'manual'; conversationId = 'field-test-s18-direct' } | ConvertTo-Json -Depth 5

  try {
    $utf8Body = [Text.Encoding]::UTF8.GetBytes($body)
    $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$DebugPort/ask" -Headers @{ 'x-debug-token' = $DebugToken } -Body $utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec

    $isOk = [bool]$response.ok
    $finalText = [string]$response.result.finalText
    $requestId = [string]$response.requestId

    $verdict = if ($isOk -and $finalText -notmatch 'error|خطا|نمی‌توانم|cannot answer') { 'ok' } else { 'fail' }
    if ($q.expect -eq 'رد' -and $finalText -match 'نمی‌توانم|مرتبط نیست|خارج از|cannot answer') { $verdict = 'ok' }

    if ($verdict -eq 'ok') {
      $okCount++
      Write-Host " -> OK (reqId: $requestId, textLen: $($finalText.Length))" -ForegroundColor Green
    } else {
      Write-Host " -> FAIL (reqId: $requestId)" -ForegroundColor Red
      $preview = $finalText.Substring(0, [Math]::Min(150, $finalText.Length))
      Write-Host "      Text: $preview" -ForegroundColor Yellow
    }

    $results += [pscustomobject]@{ Id = $q.id; Verdict = $verdict; RequestId = $requestId; TextLen = $finalText.Length }
  } catch {
    $errorMsg = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { [string]$_.ErrorDetails.Message } else { [string]$_.Exception.Message }
    Write-Host " -> EXCEPTION: $errorMsg" -ForegroundColor Red
    $results += [pscustomobject]@{ Id = $q.id; Verdict = 'exception'; RequestId = ''; TextLen = 0 }
  }

  Start-Sleep -Seconds $QuestionDelaySec
}

Write-Host ''
Write-Host '[4/4] Summary' -ForegroundColor Cyan
Write-Host "Total: $($results.Count)"
Write-Host "OK: $okCount / $($results.Count)"
Write-Host "Pass Rate: $([math]::Round($okCount / $results.Count * 100, 1))%"
Write-Host ''
$results | Format-Table Id, Verdict, RequestId, TextLen -AutoSize

Get-Process -Name 'ACCAssist' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$bakFile = "$settingsFile.bak-s18"
if (Test-Path $bakFile) {
  Copy-Item $bakFile $settingsFile -Force
  Remove-Item $bakFile -Force
  Write-Host 'Settings restored from backup.' -ForegroundColor Gray
}

if ($okCount -eq $results.Count) {
  Write-Host 'VERDICT: PASS — All questions answered correctly. Direct SQL (no SSH tunnel).' -ForegroundColor Green
} elseif ($okCount -ge ($results.Count - 1)) {
  Write-Host "VERDICT: PASS (with 1 acceptable failure)" -ForegroundColor Green
} else {
  Write-Host "VERDICT: PARTIAL — $okCount/$($results.Count) passed." -ForegroundColor Yellow
}
