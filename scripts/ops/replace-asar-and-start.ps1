$target = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Copy-Item "C:\Users\Administrator\app-v2.asar" "$target\resources\app.asar" -Force
Write-Host "ASAR_REPLACED"
$asar = Get-Item "$target\resources\app.asar"
Write-Host "ASAR_DATE=$($asar.LastWriteTime)"
Write-Host "ASAR_SIZE=$($asar.Length)"

# Start app with debug server
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken31'
$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
$proc = Start-Process -FilePath "$target\ACCAssist.exe" -ArgumentList '--agent-debug-server-only' -PassThru
Write-Host "STARTED_PID=$($proc.Id)"
Start-Sleep -Seconds 10
$alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($alive) { Write-Host "PROCESS_ALIVE" } else { Write-Host "PROCESS_DEAD" }
$ports = netstat -an | Select-String '127.0.0.1:3322'
if ($ports) { Write-Host "PORT_OPEN" } else { Write-Host "PORT_CLOSED" }
