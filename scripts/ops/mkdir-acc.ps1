$target = "C:\Users\Administrator\AppData\Local\Programs\acc-assist"
New-Item -ItemType Directory -Path $target -Force | Out-Null
New-Item -ItemType Directory -Path "$target\resources" -Force | Out-Null
Write-Host "Dirs created"
