$target = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
if (Test-Path $target) {
    $items = Get-ChildItem $target -ErrorAction SilentlyContinue
    if ($items) {
        Write-Host "TARGET_EXISTS"
        foreach ($i in $items) { Write-Host "  $($i.Name)" }
        $asar = Get-Item "$target\resources\app.asar" -ErrorAction SilentlyContinue
        if ($asar) {
            Write-Host "ASAR_SIZE=$($asar.Length)"
            Write-Host "ASAR_DATE=$($asar.LastWriteTime)"
        } else {
            Write-Host "ASAR_NOT_FOUND"
        }
    } else {
        Write-Host "TARGET_EMPTY"
    }
} else {
    Write-Host "TARGET_NOT_EXISTS"
}
$proc = Get-Process ACCAssist -ErrorAction SilentlyContinue
if ($proc) { Write-Host "ACCAssist_PID=$($proc.Id)" } else { Write-Host "ACCAssist_NOT_RUNNING" }
