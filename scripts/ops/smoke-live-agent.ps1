param(
  [string]$Prompt = 'در دیتابیس چند سال مالی قرار داره؟',
  [string]$PromptFile = '',
  [string[]]$ExpectedContains = @('سال مالی'),
  [switch]$AllowFailure,

  [string]$ServerHost = '192.168.85.56',
  [int]$Port = 2211,
  [string]$User = 'administrator',
  [string]$Password = 'Hs-co@12321#',
  [string]$HostKey = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ',
  [string]$DebugToken = 'accassist-ssh-debug-token'
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

try {
  $promptText = Resolve-PromptText
  $promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($promptText))

  $remoteScriptPath = Join-Path $PSScriptRoot 'remote-server-control.ps1'
  if (-not (Test-Path $remoteScriptPath)) {
    throw "Remote control script not found: $remoteScriptPath"
  }

  Write-Host '[smoke-live] Running remote ask-ai with PromptBase64 transport...'

  $remoteArgs = @{
    Action = 'ask-ai'
    ServerHost = $ServerHost
    Port = $Port
    User = $User
    Password = $Password
    HostKey = $HostKey
    PromptBase64 = $promptBase64
    DebugToken = $DebugToken
  }

  $rawOutput = & $remoteScriptPath @remoteArgs *>&1 | Out-String

  if ($LASTEXITCODE -ne 0) {
    throw "remote-server-control exited with code $LASTEXITCODE"
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
  Write-Error "[smoke-live] FAIL: $($_.Exception.Message)"

  if ($AllowFailure) {
    Write-Host '[smoke-live] AllowFailure is set; exiting with success code.'
    exit 0
  }

  exit 1
}
