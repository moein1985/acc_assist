param(
  [ValidateSet('status', 'install', 'uninstall', 'start', 'stop', 'restart', 'logs', 'settings', 'autoconfig-sql', 'ask-ai', 'ask-batch', 'deploy-asar', 'audit-log', 'health', 'write-settings')]
  [string]$Action = 'status',

  [string]$ServerHost = $env:ACC_REMOTE_HOST,
  [int]$Port = 2211,
  [string]$User = $env:ACC_REMOTE_USER,
  [string]$Password = $env:ACC_REMOTE_SSH_PASSWORD,
  [string]$HostKey = $env:ACC_REMOTE_HOST_KEY,

  [string]$InstallerPath = 'dist/acc-assist-1.0.0-setup.exe',
  [string]$RemoteInstallerPath = 'C:/Windows/Temp/acc-assist-1.0.0-setup.exe',

  [string]$SqlServer = '127.0.0.1',
  [int]$SqlPort = 58033,
  [string]$SqlDatabase = 'Sepidar01',
  [string]$SqlUser = $env:ACC_REMOTE_SQL_USER,
  [string]$SqlPassword = $env:ACC_REMOTE_SQL_PASSWORD,

  [string]$Prompt = '',
  [string]$PromptBase64 = '',
  [string]$PromptFile = '',
  [string]$ConversationId = 'ssh-debug',
  [string]$DebugToken = '',

  [int]$Tail = 60,

  # deploy-asar parameters
  [string]$LocalBuildDir = 'dist/win-unpacked',
  [string]$RemoteAppDir = 'C:\Users\Administrator\AppData\Local\Programs\acc-assist',
  [switch]$WriteSettings,
  [switch]$DebugMode,

  # ask-batch parameters
  [string]$QuestionsFile = '',
  [string]$QuestionsJson = '',
  [int]$QuestionDelaySec = 3,
  [int]$QueryTimeoutSec = 240,

  # audit-log parameters
  [string]$RequestId = ''
)

$ErrorActionPreference = 'Stop'

$normalizedAction = $Action.Trim().ToLowerInvariant()

if ([string]::IsNullOrWhiteSpace($ServerHost)) {
  throw 'ServerHost is required. Use -ServerHost or set ACC_REMOTE_HOST.'
}

if ([string]::IsNullOrWhiteSpace($User)) {
  throw 'User is required. Use -User or set ACC_REMOTE_USER.'
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  throw 'Password is required. Use -Password or set ACC_REMOTE_SSH_PASSWORD.'
}

if ($normalizedAction -eq 'autoconfig-sql' -and [string]::IsNullOrWhiteSpace($SqlPassword)) {
  throw 'SqlPassword is required for Action=autoconfig-sql. Use -SqlPassword or set ACC_REMOTE_SQL_PASSWORD.'
}

$SshPasswordPlainText = $Password
$SqlPasswordPlainText = $SqlPassword

function Invoke-SshCommand {
  param([string]$Command)

  if (-not [string]::IsNullOrWhiteSpace($HostKey)) {
    # Use plink with explicit host key verification
    & plink -P $Port -ssh -batch -hostkey $HostKey -pw $SshPasswordPlainText "$User@$ServerHost" $Command
  } else {
    # Fallback: use ssh.exe with auto host key acceptance
    # This requires Windows OpenSSH (built-in on Windows 10+)
    $tempKnownHosts = Join-Path $env:TEMP 'acc-assist-known-hosts'
    
    # Create wrapper to handle ssh password auth via ssh-keygen or direct call
    $sshArgs = @(
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'UserKnownHostsFile=' + $tempKnownHosts,
      '-o', 'BatchMode=no',
      '-p', [string]$Port,
      "$User@$ServerHost",
      $Command
    )
    
    # Note: This will fail if ssh.exe is not available or password auth not set up
    # For better results, set ACC_REMOTE_HOST_KEY environment variable
    Write-Error "HostKey not provided and SSH fallback is not yet fully supported. Please set ACC_REMOTE_HOST_KEY environment variable with plink host key fingerprint."
    throw "HostKey required or SSH fallback unavailable"
  }
}

function Invoke-RemotePowerShell {
  param([string]$Script)

  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
  Invoke-SshCommand "powershell -NoProfile -EncodedCommand $encoded"
}

function Resolve-PromptTransportBase64 {
  param(
    [string]$PromptValue,
    [string]$PromptBase64Value,
    [string]$PromptFileValue
  )

  function Convert-ToPromptBase64 {
    param([string]$Text)

    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text))
  }

  if (-not [string]::IsNullOrWhiteSpace($PromptFileValue)) {
    if (-not (Test-Path $PromptFileValue)) {
      throw "Prompt file not found: $PromptFileValue"
    }

    $raw = Get-Content -Raw -Path $PromptFileValue -Encoding UTF8

    try {
      $parsed = $raw | ConvertFrom-Json -AsHashtable
      if ($parsed.ContainsKey('promptBase64') -and -not [string]::IsNullOrWhiteSpace([string]$parsed['promptBase64'])) {
        return [string]$parsed['promptBase64']
      }

      if ($parsed.ContainsKey('prompt') -and -not [string]::IsNullOrWhiteSpace([string]$parsed['prompt'])) {
        return Convert-ToPromptBase64 -Text ([string]$parsed['prompt'])
      }
    } catch {
      # Fall back to raw file content below.
    }

    return Convert-ToPromptBase64 -Text $raw
  }

  if (-not [string]::IsNullOrWhiteSpace($PromptBase64Value)) {
    try {
      $parsed = $PromptBase64Value | ConvertFrom-Json -AsHashtable
      if ($parsed.ContainsKey('promptBase64') -and -not [string]::IsNullOrWhiteSpace([string]$parsed['promptBase64'])) {
        return [string]$parsed['promptBase64']
      }

      if ($parsed.ContainsKey('prompt') -and -not [string]::IsNullOrWhiteSpace([string]$parsed['prompt'])) {
        return Convert-ToPromptBase64 -Text ([string]$parsed['prompt'])
      }
    } catch {
      # Accept the supplied Base64 string directly.
    }

    return $PromptBase64Value
  }

  if (-not [string]::IsNullOrWhiteSpace($PromptValue)) {
    try {
      $parsed = $PromptValue | ConvertFrom-Json -AsHashtable
      if ($parsed.ContainsKey('promptBase64') -and -not [string]::IsNullOrWhiteSpace([string]$parsed['promptBase64'])) {
        return [string]$parsed['promptBase64']
      }

      if ($parsed.ContainsKey('prompt') -and -not [string]::IsNullOrWhiteSpace([string]$parsed['prompt'])) {
        return Convert-ToPromptBase64 -Text ([string]$parsed['prompt'])
      }
    } catch {
      # Fall back to plain prompt text.
    }

    return Convert-ToPromptBase64 -Text $PromptValue
  }

  throw 'Prompt is required for Action=ask-ai. Use -Prompt, -PromptBase64, or -PromptFile.'
}

function Copy-Installer {
  if (-not (Test-Path $InstallerPath)) {
    throw "Installer not found at '$InstallerPath'. Run npm run build:win first."
  }

  & pscp -P $Port -batch -hostkey $HostKey -pw $SshPasswordPlainText $InstallerPath "$User@${ServerHost}:$RemoteInstallerPath"
}

function Copy-File {
  param([string]$LocalPath, [string]$RemotePath)
  & pscp -P $Port -batch -hostkey $HostKey -pw $SshPasswordPlainText $LocalPath "${User}@${ServerHost}:$RemotePath"
}

function ConvertTo-PromptBase64 {
  param([string]$Text)
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text))
}

switch ($Action) {
  'status' {
    $script = @"
`$settingsPath = Join-Path `$env:APPDATA 'acc-assist\\acc-assist.settings.json'
`$exeCandidates = @(
  (Join-Path `$env:LOCALAPPDATA 'Programs\\acc-assist\\ACCAssist.exe'),
  (Join-Path `$env:LOCALAPPDATA 'Programs\\ACC Assist\\ACCAssist.exe'),
  'C:\\Program Files\\ACC Assist\\ACCAssist.exe'
)

Write-Host '---PROCESS---'
Get-Process ACCAssist -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime | Format-Table -AutoSize

Write-Host '---EXE---'
`$exeCandidates | Where-Object { Test-Path `$_ } | ForEach-Object { Get-Item `$_ | Select-Object FullName, LastWriteTime, Length | Format-List }

Write-Host '---SETTINGS---'
if (Test-Path `$settingsPath) {
  `$settings = Get-Content -Raw `$settingsPath | ConvertFrom-Json
  [pscustomobject]@{
    SqlServer = `$settings.sql.server
    SqlPort = `$settings.sql.port
    SqlDatabase = `$settings.sql.database
    SqlUser = `$settings.sql.user
    SqlEncrypt = `$settings.sql.encrypt
    SqlTrustServerCertificate = `$settings.sql.trustServerCertificate
    TelemetryEnabled = `$settings.telemetry.enabled
    TelemetryIngestUrl = `$settings.telemetry.ingestUrl
  } | Format-List
}

Write-Host '---LOG FILES---'
`$logDir = Join-Path `$env:APPDATA 'acc-assist\\logs'
if (Test-Path `$logDir) {
  Get-ChildItem `$logDir | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
}

Write-Host '---DEBUG ENDPOINT---'
[pscustomobject]@{
  Url = 'http://127.0.0.1:3322/ask'
  Health = 'http://127.0.0.1:3322/health'
} | Format-List
"@

    Invoke-RemotePowerShell $script
  }

  'install' {
    Copy-Installer

    $script = @"
Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath '$RemoteInstallerPath' -ArgumentList '/S' -Wait
Write-Host 'Install completed.'
"@

    Invoke-RemotePowerShell $script
  }

  'uninstall' {
    $script = @"
Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force

`$uninstallKeys = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)

`$app = Get-ItemProperty `$uninstallKeys -ErrorAction SilentlyContinue |
  Where-Object { `$_.DisplayName -eq 'ACC Assist' } |
  Select-Object -First 1

if (-not `$app) {
  Write-Host 'ACC Assist uninstall entry not found.'
  exit 0
}

if (`$app.QuietUninstallString) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', `$app.QuietUninstallString -Wait
} elseif (`$app.UninstallString) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', (`$app.UninstallString + ' /S') -Wait
}

Write-Host 'Uninstall completed.'
"@

    Invoke-RemotePowerShell $script
  }

  'start' {
    $script = @"
`$exeCandidates = @(
  (Join-Path `$env:LOCALAPPDATA 'Programs\\acc-assist\\ACCAssist.exe'),
  (Join-Path `$env:LOCALAPPDATA 'Programs\\ACC Assist\\ACCAssist.exe'),
  'C:\\Program Files\\ACC Assist\\ACCAssist.exe'
)
`$exe = `$exeCandidates | Where-Object { Test-Path `$_ } | Select-Object -First 1
if (-not `$exe) { throw 'ACCAssist.exe not found' }
Start-Process -FilePath `$exe
Write-Host "Started: `$exe"
"@

    Invoke-RemotePowerShell $script
  }

  'stop' {
    Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force; Write-Host 'Stopped.'"
  }

  'restart' {
    Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 1"
    & $PSCommandPath -Action start -ServerHost $ServerHost -Port $Port -User $User -Password $Password -HostKey $HostKey | Out-Host
  }

  'settings' {
    Invoke-RemotePowerShell "`$settingsPath = Join-Path `$env:APPDATA 'acc-assist\\acc-assist.settings.json'; Get-Content -Raw `$settingsPath"
  }

  'autoconfig-sql' {
    $script = @"
Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

`$settingsPath = Join-Path `$env:APPDATA 'acc-assist\\acc-assist.settings.json'
if (-not (Test-Path `$settingsPath)) { throw 'Settings file not found.' }
`$settings = Get-Content -Raw `$settingsPath | ConvertFrom-Json

`$settings.sql.server = '$SqlServer'
`$settings.sql.port = $SqlPort
`$settings.sql.database = '$SqlDatabase'
`$settings.sql.user = '$SqlUser'
`$settings.sql.password = '$SqlPasswordPlainText'
`$settings.sql.encrypt = `$false
`$settings.sql.trustServerCertificate = `$true
`$settings.sqlSecurity.enforceReadOnlyLogin = `$false

foreach (`$profile in `$settings.connectionProfiles) {
  if (`$profile.sql) {
    `$profile.sql.server = '$SqlServer'
    `$profile.sql.port = $SqlPort
    `$profile.sql.database = '$SqlDatabase'
    `$profile.sql.user = '$SqlUser'
    `$profile.sql.password = '$SqlPasswordPlainText'
    `$profile.sql.encrypt = `$false
    `$profile.sql.trustServerCertificate = `$true
  }
}

`$settings | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 `$settingsPath

[pscustomobject]@{
  SqlServer = `$settings.sql.server
  SqlPort = `$settings.sql.port
  SqlDatabase = `$settings.sql.database
  SqlUser = `$settings.sql.user
} | Format-List
"@

    Invoke-RemotePowerShell $script
  }

  'logs' {
    $script = @"
`$logPath = Join-Path `$env:APPDATA 'acc-assist\\logs\\telemetry-events.ndjson'
if (-not (Test-Path `$logPath)) { throw "Telemetry log not found: `$logPath" }
Get-Content -Path `$logPath -Tail $Tail -Wait
"@

    Invoke-RemotePowerShell $script
  }

  'ask-ai' {
    if ([string]::IsNullOrWhiteSpace($DebugToken)) {
      $DebugToken = ([guid]::NewGuid().ToString('N'))
    }

    $finalPromptBase64 = Resolve-PromptTransportBase64 -PromptValue $Prompt -PromptBase64Value $PromptBase64 -PromptFileValue $PromptFile

    $script = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

function New-DebugHeaders {
  param([string]`$Token)
  return @{ 'x-debug-token' = `$Token }
}

function Test-DebugEndpoint {
  param([string]`$Token)
  try {
    Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3322/health' -Headers (New-DebugHeaders -Token `$Token) -TimeoutSec 2 | Out-Null
    return `$true
  } catch {
    return `$false
  }
}

  if (-not (Test-DebugEndpoint -Token '$DebugToken')) {
  `$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
  `$env:ACC_AGENT_DEBUG_TOKEN = '$DebugToken'

  `$exeCandidates = @(
    (Join-Path `$env:LOCALAPPDATA 'Programs\\acc-assist\\ACCAssist.exe'),
    (Join-Path `$env:LOCALAPPDATA 'Programs\\ACC Assist\\ACCAssist.exe'),
    'C:\\Program Files\\ACC Assist\\ACCAssist.exe'
  )

  `$exe = `$exeCandidates | Where-Object { Test-Path `$_ } | Select-Object -First 1
  if (-not `$exe) { throw 'ACCAssist.exe not found' }

  Start-Process -FilePath `$exe -ArgumentList '--agent-debug-server-only'

  `$ready = `$false
  for (`$i = 0; `$i -lt 20; `$i++) {
    Start-Sleep -Seconds 1
    if (Test-DebugEndpoint -Token '$DebugToken') {
      `$ready = `$true
      break
    }
  }

  if (-not `$ready) {
    throw 'Debug endpoint did not start on 127.0.0.1:3322.'
  }
}

`$body = @{
  promptBase64 = '$finalPromptBase64'
  mode = 'manual'
  conversationId = '$ConversationId'
} | ConvertTo-Json -Depth 5

try {
  `$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
  `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers (New-DebugHeaders -Token '$DebugToken') -Body `$utf8Body -ContentType 'application/json; charset=utf-8'

  `$payload = [pscustomobject]@{
    Ok = [bool]`$response.ok
    ConversationId = [string]`$response.conversationId
    RequestId = [string]`$response.requestId
    FinalTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]`$response.result.finalText))
    ErrorTextBase64 = ''
    Rounds = [int]`$response.result.rounds
    ToolCallsUsed = [int]`$response.result.toolCallsUsed
  }
} catch {
  `$errorMessage = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
  `$payload = [pscustomobject]@{
    Ok = `$false
    ConversationId = ''
    RequestId = ''
    FinalTextBase64 = ''
    ErrorTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errorMessage))
    Rounds = 0
    ToolCallsUsed = 0
  }
}

Write-Output '__ACC_ASSIST_JSON_BEGIN__'
Write-Output (`$payload | ConvertTo-Json -Compress)
Write-Output '__ACC_ASSIST_JSON_END__'
"@

    $rawOutput = Invoke-RemotePowerShell $script | Out-String

    if ($rawOutput -match '__ACC_ASSIST_JSON_BEGIN__\s*(\{.+?\})\s*__ACC_ASSIST_JSON_END__') {
      $payload = $Matches[1] | ConvertFrom-Json
      $finalText = if ([string]::IsNullOrWhiteSpace([string]$payload.FinalTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.FinalTextBase64)) }
      $errorText = if ([string]::IsNullOrWhiteSpace([string]$payload.ErrorTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.ErrorTextBase64)) }

      Write-Host "Ok: $($payload.Ok)"
      Write-Host "ConversationId: $($payload.ConversationId)"
      Write-Host "RequestId: $($payload.RequestId)"
      Write-Host "Rounds: $($payload.Rounds)"
      Write-Host "ToolCallsUsed: $($payload.ToolCallsUsed)"
      if (-not [string]::IsNullOrWhiteSpace($errorText)) {
        Write-Host '---ERROR---'
        Write-Host $errorText
      }
      if (-not [string]::IsNullOrWhiteSpace($finalText)) {
        Write-Host '---FINAL TEXT---'
        Write-Host $finalText
      }
    } else {
      $rawOutput
    }
  }

  'deploy-asar' {
    $localAsar = Join-Path $LocalBuildDir 'resources\app.asar'
    if (-not (Test-Path $localAsar)) {
      throw "app.asar not found at '$localAsar'. Run npm run build:win first or specify -LocalBuildDir."
    }
    $asarSizeMB = [math]::Round((Get-Item $localAsar).Length / 1MB, 1)
    Write-Host "Deploying app.asar ($asarSizeMB MB) to $ServerHost..." -ForegroundColor Cyan

    # 1. Stop app
    Write-Host '[1/4] Stopping app...' -NoNewline
    Invoke-RemotePowerShell "Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force; Write-Host ' stopped'"
    Start-Sleep -Seconds 2

    # 2. Copy files
    Write-Host '[2/4] Copying files...' -NoNewline
    $remoteResources = "$RemoteAppDir\resources"
    Copy-File $localAsar "$remoteResources/app.asar"

    $localSnapshotBlob = Join-Path $LocalBuildDir 'snapshot_blob.bin'
    $localV8Context = Join-Path $LocalBuildDir 'v8_context_snapshot.bin'
    if (Test-Path $localSnapshotBlob) { Copy-File $localSnapshotBlob "$RemoteAppDir/snapshot_blob.bin" }
    if (Test-Path $localV8Context) { Copy-File $localV8Context "$RemoteAppDir/v8_context_snapshot.bin" }
    Write-Host ' done' -ForegroundColor Green

    # 3. Optionally write settings
    if ($WriteSettings) {
      Write-Host '[3/4] Writing settings.json...' -NoNewline
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

      $tempSettings = Join-Path $env:TEMP 'acc-assist-deploy-settings.json'
      $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
      [System.IO.File]::WriteAllText($tempSettings, $settingsJson, $utf8NoBom)

      $remoteSettingsDir = 'C:\Users\Administrator\AppData\Roaming\acc-assist'
      $remoteSettingsPath = "$remoteSettingsDir\acc-assist.settings.json"
      Invoke-RemotePowerShell "New-Item -ItemType Directory -Force -Path '$remoteSettingsDir' | Out-Null"
      Copy-File $tempSettings $remoteSettingsPath
      Remove-Item $tempSettings -Force -ErrorAction SilentlyContinue
      Write-Host ' done' -ForegroundColor Green
    } else {
      Write-Host '[3/4] Skipping settings (use -WriteSettings to enable)' -ForegroundColor Gray
    }

    # 4. Start app
    Write-Host '[4/4] Starting app...' -NoNewline
    $startScript = if ($DebugMode) {
      "`$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'; `$env:ACC_AGENT_DEBUG_TOKEN = '$DebugToken'; Start-Process -FilePath (Join-Path `$env:LOCALAPPDATA 'Programs\\acc-assist\\ACCAssist.exe') -ArgumentList '--agent-debug-server-only'; Write-Host ' started (debug)'"
    } else {
      "Start-Process -FilePath (Join-Path `$env:LOCALAPPDATA 'Programs\\acc-assist\\ACCAssist.exe'); Write-Host ' started'"
    }
    Invoke-RemotePowerShell $startScript
    Write-Host ' done' -ForegroundColor Green
    Write-Host "Deploy complete." -ForegroundColor Cyan
  }

  'ask-batch' {
    if ([string]::IsNullOrWhiteSpace($DebugToken)) {
      $DebugToken = ([guid]::NewGuid().ToString('N'))
    }

    # Load questions from file or JSON string
    $questions = @()
    if (-not [string]::IsNullOrWhiteSpace($QuestionsFile)) {
      if (-not (Test-Path $QuestionsFile)) { throw "Questions file not found: $QuestionsFile" }
      $questions = (Get-Content -Raw -Path $QuestionsFile -Encoding UTF8 | ConvertFrom-Json)
    } elseif (-not [string]::IsNullOrWhiteSpace($QuestionsJson)) {
      $questions = ($QuestionsJson | ConvertFrom-Json)
    } else {
      throw 'QuestionsFile or QuestionsJson is required for Action=ask-batch.'
    }

    # Build base64 for each question
    $questionLines = @()
    foreach ($q in $questions) {
      $b64 = ConvertTo-PromptBase64 -Text ([string]$q.prompt)
      $id = if ($q.id) { [string]$q.id } else { [guid]::NewGuid().ToString('N').Substring(0, 8) }
      $expectedMetric = if ($q.expectedMetricId) { [string]$q.expectedMetricId } else { '' }
      $questionLines += "  @{ id='$id'; b64='$b64'; expectedMetric='$expectedMetric' }"
    }
    $questionsBlock = $questionLines -join ",`n"

    $script = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

`$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
`$env:ACC_AGENT_DEBUG_TOKEN = '$DebugToken'

function New-DebugHeaders { return @{ 'x-debug-token' = '$DebugToken' } }
function Test-DebugEndpoint {
  try { Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3322/health' -Headers (New-DebugHeaders) -TimeoutSec 2 | Out-Null; return `$true } catch { return `$false }
}

if (-not (Test-DebugEndpoint)) {
  `$exe = Join-Path `$env:LOCALAPPDATA 'Programs\\acc-assist\\ACCAssist.exe'
  if (-not (Test-Path `$exe)) { Write-Host 'EXE_NOT_FOUND'; exit 1 }
  Start-Process -FilePath `$exe -ArgumentList '--agent-debug-server-only'
  `$ready = `$false
  for (`$i = 0; `$i -lt 30; `$i++) {
    Start-Sleep -Seconds 1
    if (Test-DebugEndpoint) { `$ready = `$true; break }
  }
  if (-not `$ready) { Write-Host 'APP_NOT_READY'; exit 1 }
}
Start-Sleep -Seconds 3
Write-Host 'APP_READY'

`$questions = @(
$questionsBlock
)

foreach (`$q in `$questions) {
  Write-Host "QUESTION_START[`$(`$q.id)]"
  `$body = @{ promptBase64 = `$q.b64; mode = 'manual'; conversationId = 'batch-$ConversationId' } | ConvertTo-Json -Depth 5
  `$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
  try {
    `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers (New-DebugHeaders) -Body `$utf8Body -ContentType 'application/json; charset=utf-8' -TimeoutSec $QueryTimeoutSec
    `$finalText = [string]`$response.result.finalText
    `$requestId = [string]`$response.requestId
    `$isOk = [bool]`$response.ok
    `$textB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$finalText))
    Write-Host "QUESTION_RESULT[`$(`$q.id)]|ok=`$isOk|reqId=`$requestId|textLen=`$(`$finalText.Length)|textB64=`$textB64"
  } catch {
    `$errMsg = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
    `$errB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errMsg))
    Write-Host "QUESTION_RESULT[`$(`$q.id)]|ok=False|reqId=|textLen=0|errB64=`$errB64"
  }
  Start-Sleep -Seconds $QuestionDelaySec
}

Get-Process ACCAssist -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host 'BATCH_DONE'
"@

    $localTempScript = Join-Path $env:TEMP 'acc-assist-batch-remote.ps1'
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($localTempScript, $script, $utf8NoBom)

    $remoteScriptPath = 'C:\Users\Administrator\AppData\Local\Temp\acc-assist-batch-remote.ps1'
    Copy-File $localTempScript $remoteScriptPath
    Remove-Item $localTempScript -Force -ErrorAction SilentlyContinue

    Write-Host "Running $($questions.Count) questions on $ServerHost..." -ForegroundColor Cyan
    $rawOutput = & plink -P $Port -ssh -batch -hostkey $HostKey -pw $SshPasswordPlainText "${User}@${ServerHost}" "powershell -NoProfile -ExecutionPolicy Bypass -File $remoteScriptPath" 2>&1 | Out-String

    # Parse results
    $results = @()
    $okCount = 0
    foreach ($line in ($rawOutput -split "`r?`n")) {
      $line = $line.Trim()
      if ($line -match '^QUESTION_RESULT\[(.+?)\]\|ok=(True|False)\|reqId=(.*?)\|textLen=(\d+)\|textB64=(.*)$') {
        $qId = $Matches[1]
        $isOk = $Matches[2] -eq 'True'
        $reqId = $Matches[3]
        $textLen = [int]$Matches[4]
        $textB64 = $Matches[5]
        $finalText = if ($textB64 -and $textB64 -ne '') { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($textB64)) } else { '' }

        $verdict = if ($isOk -and $textLen -gt 20) { 'ok' } elseif (-not $isOk -and $textLen -gt 20) { 'refuse' } else { 'fail' }
        if ($verdict -eq 'ok' -or $verdict -eq 'refuse') { $okCount++ }

        $q = $questions | Where-Object { ([string]$_.id) -eq $qId }
        $promptText = if ($q) { [string]$q.prompt } else { $qId }
        $color = if ($verdict -eq 'ok') { 'Green' } else { 'Red' }
        Write-Host "  [$qId] $promptText -> $($verdict.ToUpper()) (reqId: $reqId, len: $textLen)" -ForegroundColor $color
        $preview = $finalText.Substring(0, [Math]::Min(200, $finalText.Length))
        Write-Host "      $preview" -ForegroundColor Gray

        $results += [pscustomobject]@{
          Id = $qId; Prompt = $promptText; Ok = $isOk; Verdict = $verdict
          RequestId = $reqId; FinalTextLen = $textLen; FinalText = $preview
        }
      }
    }

    Write-Host ''
    Write-Host "Total: $($results.Count) | OK/Refuse: $okCount | Fail: $($results.Count - $okCount)" -ForegroundColor Cyan
    if ($results.Count -gt 0) {
      $results | Format-Table Id, Verdict, RequestId, FinalTextLen -AutoSize
    }
  }

  'audit-log' {
    if (-not [string]::IsNullOrWhiteSpace($RequestId)) {
      $script = "Select-String -Path 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' -Pattern '$RequestId' | ForEach-Object { `$_.Line }"
      $rawOutput = Invoke-RemotePowerShell $script | Out-String
      foreach ($line in ($rawOutput -split "`r?`n")) {
        $line = $line.Trim()
        if ($line -match '^\{.*\}') {
          try {
            $json = $Matches[1] | ConvertFrom-Json
            Write-Host "[$($json.timestamp)] stage=$($json.stage) reqId=$($json.requestId)" -ForegroundColor Cyan
            if ($json.prompt) { Write-Host "  prompt: $($json.prompt)" -ForegroundColor Gray }
            if ($json.refusalReason) { Write-Host "  refusalReason: $($json.refusalReason)" -ForegroundColor Yellow }
            if ($json.error) { Write-Host "  error: $($json.error)" -ForegroundColor Red }
            if ($json.normalizedPrompt) { Write-Host "  normalizedPrompt: $($json.normalizedPrompt)" -ForegroundColor Gray }
          } catch {
            Write-Host $Matches[1] -ForegroundColor Gray
          }
        }
      }
    } else {
      $script = "Get-Content 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log' -Tail $Tail"
      $rawOutput = Invoke-RemotePowerShell $script | Out-String
      Write-Host $rawOutput
    }
  }

  'health' {
    if ([string]::IsNullOrWhiteSpace($DebugToken)) {
      $DebugToken = 'accassist-health-check'
    }
    $script = @"
try {
  `$r = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3322/health' -Headers @{ 'x-debug-token' = '$DebugToken' } -TimeoutSec 3
  if (`$r.ok) { Write-Host 'HEALTHY' } else { Write-Host 'UNHEALTHY' }
} catch {
  Write-Host 'NOT_RUNNING'
}
"@
    $rawOutput = Invoke-RemotePowerShell $script | Out-String
    $result = $rawOutput.Trim()
    if ($result -match 'HEALTHY') {
      Write-Host "Debug endpoint: HEALTHY" -ForegroundColor Green
    } elseif ($result -match 'NOT_RUNNING') {
      Write-Host "Debug endpoint: NOT RUNNING (use -Action start or -DebugMode)" -ForegroundColor Red
    } else {
      Write-Host "Debug endpoint: UNKNOWN ($result)" -ForegroundColor Yellow
    }
  }

  'write-settings' {
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

    $tempSettings = Join-Path $env:TEMP 'acc-assist-write-settings.json'
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($tempSettings, $settingsJson, $utf8NoBom)

    $remoteSettingsDir = 'C:\Users\Administrator\AppData\Roaming\acc-assist'
    $remoteSettingsPath = "$remoteSettingsDir\acc-assist.settings.json"
    Invoke-RemotePowerShell "New-Item -ItemType Directory -Force -Path '$remoteSettingsDir' | Out-Null"
    Copy-File $tempSettings $remoteSettingsPath
    Remove-Item $tempSettings -Force -ErrorAction SilentlyContinue
    Write-Host "Settings written to $ServerHost (DB: $SqlDatabase, Port: $SqlPort)" -ForegroundColor Green
  }
}
