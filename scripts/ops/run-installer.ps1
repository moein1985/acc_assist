$installer = "C:\Windows\Temp\acc-assist-1.0.0-setup.exe"
if (-not (Test-Path $installer)) {
    Write-Host "INSTALLER_NOT_FOUND"
    exit 1
}
Write-Host "Running installer..."
$proc = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
Write-Host "Installer exit code: $($proc.ExitCode)"
Start-Sleep -Seconds 5
$target = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
if (Test-Path "$target\ACCAssist.exe") {
    Write-Host "INSTALL_OK"
    $asar = Get-Item "$target\resources\app.asar"
    Write-Host "ASAR_DATE=$($asar.LastWriteTime)"
    Write-Host "ASAR_SIZE=$($asar.Length)"
} else {
    Write-Host "INSTALL_FAILED"
    # List what's in the target dir
    if (Test-Path $target) {
        Get-ChildItem $target -Recurse -Depth 1 | ForEach-Object { Write-Host $_.FullName }
    } else {
        Write-Host "TARGET_DIR_NOT_EXISTS"
    }
}
