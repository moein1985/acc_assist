$lines = Get-Content C:\Users\Administrator\AppData\Roaming\acc-assist\logs\agent-audit.log -Tail 80
$lines | Where-Object { $_ -match 'refuse|error|model-call-failed|intent-mismatch' } | ForEach-Object { $_.Substring(0, [Math]::Min(200, $_.Length)) }
