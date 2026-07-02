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
  [int]$DebugPort = 3322
)

$ErrorActionPreference = 'Stop'

$appDataDir = Join-Path $env:APPDATA 'acc-assist'
$settingsFile = Join-Path $appDataDir 'acc-assist.settings.json'
$backupFile = Join-Path $appDataDir 'acc-assist.settings.json.bak-diag'
$exePath = Join-Path $env:LOCALAPPDATA 'Programs\acc-assist\ACCAssist.exe'

Write-Host '=== TUNNEL DIAGNOSTIC ===' -ForegroundColor Cyan

# Backup settings
if (Test-Path $settingsFile) {
  Copy-Item $settingsFile $backupFile -Force
}

# Write SSH settings
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
  mobileBridge = @{ enabled = $false; host = '127.0.0.1'; port = 3310; allowedOrigin = 'xapi.test' }
  telemetry = @{ enabled = $false; ingestUrl = ''; bearerToken = ''; logLevel = 'debug'; flushIntervalMs = 5000; requestTimeoutMs = 8000; maxBatchSize = 25; maxQueueSize = 5000; includeRendererErrors = $true; retentionDays = 30 }
  connectionProfiles = @(
    @{
      id = 'ssh-sepidar-field-test'
      metadata = @{ name = 'Sepidar SSH Field Test'; description = 'SSH tunnel to Sepidar for S16 field test'; type = 'ssh'; lastTestStatus = 'never'; lastTestMessage = ''; lastTestAt = $null }
      sql = @{ server = '127.0.0.1'; database = $SqlDatabase; user = $SqlUser; password = $SqlPassword; port = $SqlPort; encrypt = $false; trustServerCertificate = $true; connectionTimeoutMs = 15000; requestTimeoutMs = 45000; connectionRetryCount = 2; connectionRetryDelayMs = 2000 }
      ssh = @{ enabled = $true; host = $SshHost; port = $SshPort; username = $SshUser; password = $SshPassword; privateKey = ''; passphrase = ''; dstHost = '127.0.0.1'; dstPort = $SqlPort; localPort = $null; readyTimeoutMs = 20000; keepaliveIntervalMs = 10000; connectTimeoutMs = 15000; reconnectEnabled = $true; maxReconnectAttempts = 3 }
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
Write-Host '[1] Settings written.' -ForegroundColor Green

# Start app
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = $DebugToken
Get-Process -Name 'ACCAssist' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host '[2] Starting ACC Assist...' -NoNewline
Start-Process -FilePath $exePath -ArgumentList '--agent-debug-server-only'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$DebugPort/health" -Headers @{ 'x-debug-token' = $DebugToken } -TimeoutSec 2
    if ($resp.ok) { $ready = $true; break }
  } catch {}
}
if ($ready) { Write-Host ' READY' -ForegroundColor Green } else { Write-Host ' TIMEOUT' -ForegroundColor Red; exit 1 }

Write-Host '[3] Waiting 15s for SSH tunnel + SQL auto-connect...' -NoNewline
Start-Sleep -Seconds 15
Write-Host ' done' -ForegroundColor Green

# Send a simple query
Write-Host '[4] Sending test query: "SELECT 1 AS ok"...' -NoNewline
$testPrompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('2KfYsdi02KfYsSDYs9in24LYjCDYqNiv2YjYp9uM2KfYsSDYqNix24zaug=='))
$promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($testPrompt))
$body = @{ promptBase64 = $promptBase64; mode = 'manual'; conversationId = 'diag-test' } | ConvertTo-Json -Depth 5
$utf8Body = [Text.Encoding]::UTF8.GetBytes($body)

try {
  $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$DebugPort/ask" -Headers @{ 'x-debug-token' = $DebugToken } -Body $utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec 120
  Write-Host ' DONE' -ForegroundColor Green
  Write-Host "  ok: $($response.ok)"
  Write-Host "  requestId: $($response.requestId)"
  $text = [string]$response.result.finalText
  $preview = $text.Substring(0, [Math]::Min(500, $text.Length))
  Write-Host "  finalText ($($text.Length) chars): $preview" -ForegroundColor Gray
} catch {
  Write-Host " ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Check app logs
Write-Host ''
Write-Host '[5] Checking app logs for tunnel/SQL status...' -ForegroundColor Cyan
$logDir = Join-Path $appDataDir 'logs'
if (Test-Path $logDir) {
  $latestLog = Get-ChildItem $logDir -Filter '*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latestLog) {
    $logContent = Get-Content $latestLog.FullName -Tail 50 -Encoding UTF8
    $logContent | Where-Object { $_ -match 'ssh|tunnel|sql|connection|error|pool' } | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
  }
}

# Cleanup
Get-Process -Name 'ACCAssist' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
if (Test-Path $backupFile) {
  Copy-Item $backupFile $settingsFile -Force
  Remove-Item $backupFile -Force
  Write-Host '[6] Settings restored.' -ForegroundColor Green
}
