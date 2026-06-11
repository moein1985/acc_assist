param(
  [ValidateSet('status', 'install', 'uninstall', 'start', 'stop', 'restart', 'logs', 'settings', 'autoconfig-sql', 'ask-ai')]
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
  [string]$DebugToken = '',

  [int]$Tail = 60
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

if ([string]::IsNullOrWhiteSpace($HostKey)) {
  throw 'HostKey is required. Use -HostKey or set ACC_REMOTE_HOST_KEY.'
}

if ($normalizedAction -eq 'autoconfig-sql' -and [string]::IsNullOrWhiteSpace($SqlPassword)) {
  throw 'SqlPassword is required for Action=autoconfig-sql. Use -SqlPassword or set ACC_REMOTE_SQL_PASSWORD.'
}

$SshPasswordPlainText = $Password
$SqlPasswordPlainText = $SqlPassword

function Invoke-SshCommand {
  param([string]$Command)

  & plink -P $Port -ssh -batch -hostkey $HostKey -pw $SshPasswordPlainText "$User@$ServerHost" $Command
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
`$prompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$finalPromptBase64'))

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
  prompt = `$prompt
  mode = 'manual'
  conversationId = 'ssh-debug'
} | ConvertTo-Json -Depth 5

try {
  `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers (New-DebugHeaders -Token '$DebugToken') -Body `$body -ContentType 'application/json'

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
}
