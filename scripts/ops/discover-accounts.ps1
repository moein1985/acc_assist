<#
.SYNOPSIS
  Discover Sepidar account hierarchy (Type 1 and 2) to fix reconciliation Side B queries.
#>
param(
  [string]$SshHost = '192.168.85.56',
  [int]$SshPort = 2211,
  [string]$SshUser = 'administrator',
  [string]$SshPassword = 'Hs-co@12321#',
  [string]$HostKey = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ',
  [string]$SqlUser = 'damavand',
  [string]$SqlPassword = 'damavand',
  [string]$SqlDatabase = 'Sepidar01'
)

$PlinkExe = 'C:\Program Files\PuTTY\plink.exe'

function Invoke-SqlcmdRemote {
  param([string]$Sql)
  $sqlBytes = [Text.Encoding]::Unicode.GetBytes($Sql)
  $sqlB64 = [Convert]::ToBase64String($sqlBytes)
  $remoteScript = "`$ErrorActionPreference = 'Stop';"
  $remoteScript += "`$sql = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('$sqlB64'));"
  $remoteScript += "`$tmpFile = [IO.Path]::GetTempFileName() + '.sql';"
  $remoteScript += "Set-Content -Path `$tmpFile -Value ('SET NOCOUNT ON;`r`n' + `$sql) -Encoding Unicode -NoNewline;"
  $remoteScript += "try {"
  $remoteScript += "  `$raw = & sqlcmd -S 127.0.0.1,58033 -U $SqlUser -P $SqlPassword -d $SqlDatabase -i `$tmpFile -W 2>&1;"
  $remoteScript += "  Remove-Item `$tmpFile -ErrorAction SilentlyContinue;"
  $remoteScript += "  Write-Output (`$raw | Out-String);"
  $remoteScript += "} catch {"
  $remoteScript += "  Remove-Item `$tmpFile -ErrorAction SilentlyContinue;"
  $remoteScript += "  Write-Output ('ERROR:' + `$_.Exception.Message)"
  $remoteScript += "}"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
  $raw = & $PlinkExe -P $SshPort -ssh -batch -hostkey $HostKey -pw $SshPassword "$SshUser@$SshHost" "powershell -NoProfile -EncodedCommand $encoded" 2>&1
  return ($raw | Out-String).Trim()
}

Write-Host "=== Account Hierarchy (Type 1 and 2) ===" -ForegroundColor Cyan
$sql1 = "SELECT Type, Code, Title, ParentAccountRef FROM ACC.Account WHERE Type = 1 ORDER BY Code"
Write-Host "`n--- Type 1 (Main Categories) ---" -ForegroundColor Yellow
$result1 = Invoke-SqlcmdRemote -Sql $sql1
Write-Host $result1

Write-Host "`n--- Type 2 (Sub Categories) ---" -ForegroundColor Yellow
$sql2 = "SELECT Type, Code, Title, ParentAccountRef FROM ACC.Account WHERE Type = 2 ORDER BY Code"
$result2 = Invoke-SqlcmdRemote -Sql $sql2
Write-Host $result2

Write-Host "`n=== Bank Account Hierarchy ===" -ForegroundColor Cyan
$sql3 = "SELECT a.Type, a.Code, a.Title, p.Type AS ParentType, p.Code AS ParentCode, p.Title AS ParentTitle FROM ACC.Account a LEFT JOIN ACC.Account p ON a.ParentAccountRef = p.AccountId WHERE a.Code LIKE '0102%' OR a.Code LIKE '02%' ORDER BY a.Code"
$result3 = Invoke-SqlcmdRemote -Sql $sql3
Write-Host $result3

Write-Host "`n=== Inventory Account Hierarchy ===" -ForegroundColor Cyan
$sql4 = "SELECT a.Type, a.Code, a.Title, p.Type AS ParentType, p.Code AS ParentCode, p.Title AS ParentTitle FROM ACC.Account a LEFT JOIN ACC.Account p ON a.ParentAccountRef = p.AccountId WHERE a.Code LIKE '0103%' OR a.Code LIKE '03%' ORDER BY a.Code"
$result4 = Invoke-SqlcmdRemote -Sql $sql4
Write-Host $result4
