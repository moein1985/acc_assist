Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$targetDir = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
if (-not (Test-Path $targetDir)) {
    Write-Host "TARGET_DIR_NOT_EXISTS - running installer"
    & "C:\Windows\Temp\acc-assist-1.0.0-setup.exe" /S
    Start-Sleep -Seconds 20
}
$asarPath = "$targetDir\resources\app.asar"
Copy-Item "C:\Users\Administrator\app.asar" $asarPath -Force
Write-Host "ASAR_COPIED"
$asar = Get-Item $asarPath
Write-Host "NEW_ASAR_DATE=$($asar.LastWriteTime)"
Write-Host "NEW_ASAR_SIZE=$($asar.Length)"

# Also copy V8 snapshot files
$snapSrc = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
$v8Files = @("snapshot_blob.bin", "v8_context_snapshot.bin")
foreach ($f in $v8Files) {
    $src = "$snapSrc\$f"
    if (Test-Path $src) {
        Write-Host "V8_EXISTS: $f"
    }
}

# Start app with debug server
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken31'
$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
$proc = Start-Process -FilePath "$targetDir\ACCAssist.exe" -ArgumentList '--agent-debug-server-only' -PassThru
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
