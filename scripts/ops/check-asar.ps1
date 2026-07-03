$asar = Get-Item "C:\Users\Administrator\AppData\Local\Programs\acc-assist\resources\app.asar" -ErrorAction SilentlyContinue
if ($asar) {
    Write-Host "ASAR_SIZE=$($asar.Length)"
    Write-Host "ASAR_DATE=$($asar.LastWriteTime)"
} else {
    Write-Host "ASAR_NOT_FOUND"
}
$exe = Get-Item "C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe" -ErrorAction SilentlyContinue
if ($exe) {
    Write-Host "EXE_DATE=$($exe.LastWriteTime)"
}
