$proc = Get-Process ACCAssist -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "PROCESS_RUNNING: $($proc.Id -join ', ')"
} else {
    Write-Host "PROCESS_NOT_FOUND"
}
$ports = netstat -an | Select-String '3322'
if ($ports) {
    Write-Host "PORT_STATUS:"
    $ports | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "PORT_CLOSED"
}
Write-Host "---HEALTH_CHECK---"
try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:3322/health" -Headers @{"x-debug-token"="testtoken31"} -TimeoutSec 10
    Write-Host "HEALTH_OK: $($resp | ConvertTo-Json -Compress)"
} catch {
    Write-Host "HEALTH_FAIL: $($_.Exception.Message)"
}
Write-Host "---AUDIT_LOG_TAIL---"
$logPath = "C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log"
if (Test-Path $logPath) {
    Get-Content $logPath -Tail 5
} else {
    Write-Host "NO_AUDIT_LOG"
}
