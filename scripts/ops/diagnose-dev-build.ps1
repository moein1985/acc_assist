$ErrorActionPreference = 'Stop'

$appDataDir = Join-Path $env:APPDATA 'acc-assist'
$settingsFile = Join-Path $appDataDir 'acc-assist.settings.json'
$backupFile = Join-Path $appDataDir 'acc-assist.settings.json.bak-diag3'
$stderrLog = Join-Path $appDataDir 'diag-stderr3.log'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..'))
$electronExe = Join-Path $projectRoot 'node_modules' 'electron' 'dist' 'electron.exe'

Write-Host "Electron: $electronExe"
Write-Host "Project root: $projectRoot"

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
    database = 'Sepidar01'
    user = 'damavand'
    password = 'damavand'
    port = 58033
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
    host = '192.168.85.56'
    port = 2211
    username = 'administrator'
    password = 'Hs-co@12321#'
    privateKey = ''
    passphrase = ''
    dstHost = '127.0.0.1'
    dstPort = 58033
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
      metadata = @{ name = 'Sepidar SSH Field Test'; description = 'SSH tunnel to Sepidar'; type = 'ssh'; lastTestStatus = 'never'; lastTestMessage = ''; lastTestAt = $null }
      sql = @{ server = '127.0.0.1'; database = 'Sepidar01'; user = 'damavand'; password = 'damavand'; port = 58033; encrypt = $false; trustServerCertificate = $true; connectionTimeoutMs = 15000; requestTimeoutMs = 45000; connectionRetryCount = 2; connectionRetryDelayMs = 2000 }
      ssh = @{ enabled = $true; host = '192.168.85.56'; port = 2211; username = 'administrator'; password = 'Hs-co@12321#'; privateKey = ''; passphrase = ''; dstHost = '127.0.0.1'; dstPort = 58033; localPort = $null; readyTimeoutMs = 20000; keepaliveIntervalMs = 10000; connectTimeoutMs = 15000; reconnectEnabled = $true; maxReconnectAttempts = 3 }
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

# Kill any existing instances
taskkill /F /IM electron.exe 2>$null
Start-Sleep -Seconds 1

# Remove old stderr log
if (Test-Path $stderrLog) { Remove-Item $stderrLog -Force }

# Start app from dev build with stderr capture
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'accassist-ssh-debug-token'

Write-Host '[2] Starting Electron from dev build...' -NoNewline
$proc = Start-Process -FilePath $electronExe -ArgumentList "--agent-debug-server-only" -WorkingDirectory $projectRoot -RedirectStandardError $stderrLog -PassThru -NoNewWindow
Write-Host " PID=$($proc.Id)" -ForegroundColor Green

# Wait for debug server
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:3322/health" -Headers @{ 'x-debug-token' = 'accassist-ssh-debug-token' } -TimeoutSec 2
    if ($resp.ok) { $ready = $true; break }
  } catch {}
}
if ($ready) { Write-Host '[3] READY' -ForegroundColor Green } else { Write-Host '[3] TIMEOUT' -ForegroundColor Red; exit 1 }

Write-Host '[4] Waiting 25s for auto-connect...' -NoNewline
Start-Sleep -Seconds 25
Write-Host ' done' -ForegroundColor Green

# Read stderr log
Write-Host ''
Write-Host '=== STDERR DIAG OUTPUT ===' -ForegroundColor Cyan
if (Test-Path $stderrLog) {
  $stderrContent = Get-Content $stderrLog -Encoding UTF8
  $diagLines = $stderrContent | Where-Object { $_ -match 'DIAG|ESOCKET|error|Error|tunnel|forwardOut|stream|socket|tedious' }
  $diagLines | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
  Write-Host ""
  Write-Host "  Total stderr lines: $($stderrContent.Count)" -ForegroundColor Gray
  Write-Host "  DIAG lines: $($diagLines.Count)" -ForegroundColor Gray
} else {
  Write-Host '  No stderr log found!' -ForegroundColor Red
}

# Cleanup
Write-Host ''
Write-Host '[5] Stopping app...' -ForegroundColor Cyan
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Restore settings
if (Test-Path $backupFile) {
  Copy-Item $backupFile $settingsFile -Force
  Remove-Item $backupFile -Force
  Write-Host '[6] Settings restored.' -ForegroundColor Green
}
