Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken31'
$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe'
Start-Sleep -Seconds 8
$result = netstat -an | Select-String '3322'
if ($result) {
    Write-Host "PORT_OPEN"
    $result | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "PORT_CLOSED"
    $proc = Get-Process ACCAssist -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "PROCESS_RUNNING: $($proc.Id)"
    } else {
        Write-Host "PROCESS_NOT_FOUND"
    }
}
