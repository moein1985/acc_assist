Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken31'
$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe' -ArgumentList '--agent-debug-server-only'
Start-Sleep -Seconds 10
$proc = Get-Process ACCAssist -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "PROCESS_RUNNING: $($proc.Id)"
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
