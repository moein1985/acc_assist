$target = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
Get-ChildItem $target -Recurse -Depth 1 | ForEach-Object { Write-Host "$($_.FullName) ($($_.Length))" }
