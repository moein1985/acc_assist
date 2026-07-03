$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken31'
$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe'
Start-Sleep -Seconds 3
Get-Process ACCAssist -ErrorAction SilentlyContinue | Select-Object Id, ProcessName
