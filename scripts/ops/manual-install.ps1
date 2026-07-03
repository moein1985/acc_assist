Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$target = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
if (Test-Path $target) {
    Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
New-Item -ItemType Directory -Path $target -Force | Out-Null
New-Item -ItemType Directory -Path "$target\resources" -Force | Out-Null
Copy-Item "C:\Users\Administrator\acc-unpacked\*" $target -Recurse -Force
Start-Sleep -Seconds 2
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
}
