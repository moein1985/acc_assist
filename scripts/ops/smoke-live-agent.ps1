param(
  [string]$Prompt = 'در دیتابیس چند سال مالی قرار داره؟',
  [string]$PromptFile = '',
  [string[]]$ExpectedContains = @('سال مالی'),
  [switch]$AllowFailure,

  [string]$ServerHost = '192.168.85.56',
  [int]$Port = 2211,
  [string]$User = 'administrator',
  [string]$Password = 'Hs-co@12321#',
  [string]$HostKey = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
)

$ErrorActionPreference = 'Stop'

function Resolve-PromptText {
  if (-not [string]::IsNullOrWhiteSpace($PromptFile)) {
    if (-not (Test-Path $PromptFile)) {
      throw "Prompt file not found: $PromptFile"
    }

    return Get-Content -Raw -Path $PromptFile -Encoding UTF8
  }

  if (-not [string]::IsNullOrWhiteSpace($Prompt)) {
    return $Prompt
  }

  throw 'Prompt text is empty. Use -Prompt or -PromptFile.'
}

function Invoke-RemoteSmokeRun {
  param(
    [string]$PromptBase64,
    [string]$DebugToken
  )

  $remoteScriptPath = Join-Path $PSScriptRoot 'remote-server-control.ps1'
  if (-not (Test-Path $remoteScriptPath)) {
    throw "Remote control script not found: $remoteScriptPath"
  }

  $remoteArgs = @{
    Action = 'ask-ai'
    ServerHost = $ServerHost
    Port = $Port
    User = $User
    Password = $Password
    HostKey = $HostKey
    PromptBase64 = $PromptBase64
    DebugToken = $DebugToken
  }

  $rawOutput = & $remoteScriptPath @remoteArgs *>&1 | Out-String

  return [pscustomobject]@{
    RawOutput = $rawOutput
    ExitCode = $LASTEXITCODE
  }
}

try {
  $promptText = Resolve-PromptText
  $promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($promptText))

  Write-Host '[smoke-live] Running remote ask-ai with PromptBase64 transport...'

  $generatedDebugToken = ([guid]::NewGuid().ToString('N'))
  $runResult = Invoke-RemoteSmokeRun -PromptBase64 $promptBase64 -DebugToken $generatedDebugToken

  if ($runResult.ExitCode -ne 0 -and $runResult.RawOutput -match 'Debug endpoint did not start') {
    Write-Host '[smoke-live] Retrying with legacy debug token for installed build compatibility...'
    $runResult = Invoke-RemoteSmokeRun -PromptBase64 $promptBase64 -DebugToken 'accassist-ssh-debug-token'
  }

  $rawOutput = $runResult.RawOutput

  if ($runResult.ExitCode -ne 0) {
    throw "remote-server-control exited with code $($runResult.ExitCode)"
  }

  $okMatch = [regex]::Match($rawOutput, '(?m)^Ok:\s*(True|False)\s*$')
  if (-not $okMatch.Success) {
    throw "Smoke output missing Ok status. Raw output:`n$rawOutput"
  }

  $isOk = $okMatch.Groups[1].Value -eq 'True'
  if (-not $isOk) {
    throw "Live smoke failed: Ok=False. Raw output:`n$rawOutput"
  }

  $finalText = ''
  $finalMatch = [regex]::Match($rawOutput, '(?s)---FINAL TEXT---\s*(.+)$')
  if ($finalMatch.Success) {
    $finalText = $finalMatch.Groups[1].Value.Trim()
  }

  foreach ($needle in $ExpectedContains) {
    if ([string]::IsNullOrWhiteSpace($needle)) {
      continue
    }

    if ($finalText -notlike "*$needle*") {
      throw "Live smoke assertion failed: final text does not contain [$needle]."
    }
  }

  Write-Host '[smoke-live] PASS'
  Write-Host "[smoke-live] PromptLength=$($promptText.Length), FinalLength=$($finalText.Length)"
  exit 0
} catch {
  if ($AllowFailure) {
    Write-Host "[smoke-live] FAIL (allowed): $($_.Exception.Message)"
    Write-Host '[smoke-live] AllowFailure is set; exiting with success code.'
    exit 0
  }

  Write-Error "[smoke-live] FAIL: $($_.Exception.Message)"

  exit 1
}
