$target = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
if (Test-Path $target) {
    Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
Write-Host "Extracting zip..."
Expand-Archive -Path "C:\Users\Administrator\acc-unpacked.zip" -DestinationPath $target -Force
Write-Host "Extraction done"
$asar = Get-Item "$target\resources\app.asar" -ErrorAction SilentlyContinue
if ($asar) {
    Write-Host "ASAR_SIZE=$($asar.Length)"
    Write-Host "ASAR_DATE=$($asar.LastWriteTime)"
} else {
    Write-Host "ASAR_NOT_FOUND"
}
$exe = Get-Item "$target\ACCAssist.exe" -ErrorAction SilentlyContinue
if ($exe) {
    Write-Host "EXE_FOUND"
} else {
    Write-Host "EXE_NOT_FOUND"
    exit 1
}

# Copy settings file
$settingsSrc = "C:\Users\Administrator\acc-assist.settings.json"
$settingsDest = "$target\resources\acc-assist.settings.json"
if (Test-Path $settingsSrc) {
    Copy-Item $settingsSrc $settingsDest -Force
    Write-Host "SETTINGS_COPIED"
} else {
    Write-Host "SETTINGS_NOT_FOUND - will use defaults"
}

# Start app with debug server
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken31'
$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
$proc = Start-Process -FilePath "$target\ACCAssist.exe" -ArgumentList '--agent-debug-server-only' -PassThru
Write-Host "STARTED_PID=$($proc.Id)"
Start-Sleep -Seconds 10
$alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($alive) {
    Write-Host "PROCESS_ALIVE"
} else {
    Write-Host "PROCESS_DEAD"
}
$ports = netstat -an | Select-String '127.0.0.1:3322'
if ($ports) {
    Write-Host "PORT_OPEN"
} else {
    Write-Host "PORT_CLOSED"
}
