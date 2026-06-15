param(
  [string]$ServerHost = '192.168.85.56',
  [int]$Port = 2211,
  [string]$User = 'administrator',
  [string]$Password = 'Hs-co@12321#',
  [string]$HostKey = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ',
  [int]$Minutes = 30
)

$ErrorActionPreference = 'Stop'

$cmd = @'
$ErrorActionPreference = 'Stop'
$fromUtc = (Get-Date).ToUniversalTime().AddMinutes(-%%MINUTES%%)
$audit = 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log'
$tele = 'C:\Users\Administrator\AppData\Roaming\acc-assist\logs\telemetry-events.ndjson'

Write-Host '---AUDIT-TAIL---'
Get-Content -Path $audit -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $j = $_ | ConvertFrom-Json -AsHashtable
    if ($j.timestamp) {
      $ts = [DateTimeOffset]::Parse([string]$j.timestamp)
      if ($ts -ge $fromUtc) {
        $j | ConvertTo-Json -Depth 100
      }
    }
  } catch {}
}

Write-Host '---TELEMETRY-TAIL---'
Get-Content -Path $tele -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $j = $_ | ConvertFrom-Json -AsHashtable
    if ($j.timestamp) {
      $ts = [DateTimeOffset]::Parse([string]$j.timestamp)
      if ($ts -ge $fromUtc) {
        $j | ConvertTo-Json -Depth 100
      }
    }
  } catch {}
}
'@

$cmd = $cmd.Replace('%%MINUTES%%', [string]$Minutes)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))

& plink -P $Port -ssh -batch -hostkey $HostKey -pw $Password "$User@$ServerHost" "powershell -NoProfile -EncodedCommand $encoded"
