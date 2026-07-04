$exePath = 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe'
$action = New-ScheduledTaskAction -Execute $exePath -WorkingDirectory 'C:\Users\Administrator'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'StartACCAssist' -Action $action -Trigger $trigger -Settings $settings -User 'Administrator' -RunLevel Highest -Force
Start-Sleep -Seconds 8
$proc = Get-Process ACCAssist -ErrorAction SilentlyContinue
if ($proc) {
    Write-Output "Process running with PID: $($proc.Id)"
} else {
    Write-Output "Process not running"
}
Unregister-ScheduledTask -TaskName 'StartACCAssist' -Confirm:$false
