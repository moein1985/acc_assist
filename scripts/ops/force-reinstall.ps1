Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Remove-Item -Recurse -Force "C:\Users\Administrator\AppData\Local\Programs\acc-assist" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host "Old install removed"
& "C:\Windows\Temp\acc-assist-1.0.0-setup.exe" /S
Start-Sleep -Seconds 15
$asar = Get-Item "C:\Users\Administrator\AppData\Local\Programs\acc-assist\resources\app.asar" -ErrorAction SilentlyContinue
if ($asar) {
    Write-Host "NEW_ASAR_DATE=$($asar.LastWriteTime)"
    Write-Host "NEW_ASAR_SIZE=$($asar.Length)"
} else {
    Write-Host "ASAR_NOT_FOUND_AFTER_INSTALL"
}
