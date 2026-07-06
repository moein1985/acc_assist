Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken123'
Start-Process 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe'
Write-Host 'Started with debug server enabled'
