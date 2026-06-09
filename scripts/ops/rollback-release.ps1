param(
  [Parameter(Mandatory = $true)]
  [string]$UpdatesRoot,

  [Parameter(Mandatory = $true)]
  [string]$BackupRoot,

  [Parameter(Mandatory = $true)]
  [string]$PreviousVersion,

  [ValidateSet('latest', 'rc', 'beta', 'alpha')]
  [string]$Channel = 'latest',

  [switch]$WhatIfMode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ManifestName {
  param([string]$ReleaseChannel)

  if ($ReleaseChannel -eq 'latest') {
    return 'latest.yml'
  }

  return "$ReleaseChannel.yml"
}

function Assert-PathExists {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label not found: $Path"
  }
}

$resolvedUpdatesRoot = Resolve-Path -LiteralPath $UpdatesRoot
$resolvedBackupRoot = Resolve-Path -LiteralPath $BackupRoot
$manifestName = Resolve-ManifestName -ReleaseChannel $Channel
$backupManifestPath = Join-Path $resolvedBackupRoot $manifestName
$targetManifestPath = Join-Path $resolvedUpdatesRoot $manifestName

Assert-PathExists -Path $resolvedUpdatesRoot -Label 'UpdatesRoot'
Assert-PathExists -Path $resolvedBackupRoot -Label 'BackupRoot'
Assert-PathExists -Path $backupManifestPath -Label 'Backup manifest'

$artifactCandidates = Get-ChildItem -LiteralPath $resolvedBackupRoot -File |
  Where-Object { $_.Name -match [regex]::Escape($PreviousVersion) }

if ($artifactCandidates.Count -eq 0) {
  throw "No backup artifacts found for version $PreviousVersion under $resolvedBackupRoot"
}

Write-Host "Rollback channel: $Channel"
Write-Host "Restore manifest: $backupManifestPath -> $targetManifestPath"
Write-Host "Artifacts matched: $($artifactCandidates.Count)"

if ($WhatIfMode) {
  Write-Host 'WhatIf mode enabled; no files were copied.'
  exit 0
}

Copy-Item -LiteralPath $backupManifestPath -Destination $targetManifestPath -Force

foreach ($artifact in $artifactCandidates) {
  $destination = Join-Path $resolvedUpdatesRoot $artifact.Name
  Copy-Item -LiteralPath $artifact.FullName -Destination $destination -Force
}

Write-Host 'Rollback file restore completed successfully.'
Write-Host 'Next steps:'
Write-Host '1) Verify manifest integrity and sha512 values.'
Write-Host '2) Run a canary update test on one machine before broad rollout.'
