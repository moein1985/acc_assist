$lines = Get-Content C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log -Tail 80
$lines | Where-Object { $_ -match 'calibration-mapping' } | Select-Object -First 5 | ForEach-Object { $_.Substring(0, [Math]::Min(250, $_.Length)) }
