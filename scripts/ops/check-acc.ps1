$proc = Get-Process ACCAssist -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "PROCESS_RUNNING: $($proc.Id -join ', ')"
} else {
    Write-Host "PROCESS_NOT_FOUND"
}
$ports = netstat -an | Select-String '3322'
if ($ports) {
    Write-Host "PORT_OPEN"
    $ports | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "PORT_CLOSED"
}
