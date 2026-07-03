Stop-Process -Name ACCAssist -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
$env:ACC_AGENT_DEBUG_TOKEN = 'testtoken31'
$env:ACC_FINANCIAL_ENGINE_MODE = 'engine'
$proc = Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\Programs\acc-assist\ACCAssist.exe' -ArgumentList '--agent-debug-server-only' -PassThru
Write-Host "Started PID: $($proc.Id)"

# Wait for port to open
$maxWait = 30
$waited = 0
$portOpen = $false
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++
    $alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if (-not $alive) {
        Write-Host "Process died after ${waited}s"
        break
    }
    $ports = netstat -an | Select-String '127.0.0.1:3322'
    if ($ports) {
        $portOpen = $true
        Write-Host "Port open after ${waited}s"
        break
    }
}

if (-not $portOpen) {
    Write-Host "PORT_NEVER_OPENED"
    exit 1
}

# Health check
try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:3322/health" -Headers @{"x-debug-token"="testtoken31"} -TimeoutSec 10
    Write-Host "Health: $($h | ConvertTo-Json -Compress)"
} catch {
    Write-Host "Health FAIL: $($_.Exception.Message)"
    exit 1
}

# Questions with base64 prompts
$prompts = @(
    @{ id='q1'; b64='2YHYsdmI2LQg27HbtNuw27Ig2obZgtiv2LEg2KfYs9iq2J8=' },
    @{ id='q2'; b64='2KrYsdin2LLZhtin2YXZhyDbsdu027Dbsg==' },
    @{ id='q3'; b64='2LPZiNivINiu2KfZhNi1INux27TbsNuy' },
    @{ id='q4'; b64='2YXYp9mG2K/ZhyDYqNin2YbaqduMINux27TbsNuy' },
    @{ id='q5'; b64='2YfYstuM2YbZh+KAjNmH2KfbjCDZvtix2LPZhtmE24wg27HbtNuw27I=' },
    @{ id='q6'; b64='2K/YsduM2KfZgdiq2YbbjOKAjNmH2KfbjCDbsdu027Dbsg==' },
    @{ id='q7'; b64='2b7Ysdiv2KfYrtiq2YbbjOKAjNmH2KfbjCDbsdu027Dbsg==' },
    @{ id='q8'; b64='2KjZh9in24wg2KrZhdin2YUg2LTYr9mHINux27TbsNuy' },
    @{ id='q9'; b64='2YfZiNin24wg2KrZh9ix2KfZhiDYp9mF2LHZiNiyINqG2LfZiNixINin2LPYqtif' },
    @{ id='q10'; b64='2YLbjNmF2Kog2LfZhNinINiv2LEg2KjYp9iy2KfYsSDahtmC2K/YsSDYp9iz2KrYnw==' },
    @{ id='q11'; b64='2KrYudiv2KfYryDaqdin2LHZhdmG2K/Yp9mGINi02LHaqdiqINqG2YLYr9ixINin2LPYqtif' },
    @{ id='q12'; b64='2obYt9mI2LEg2YHYp9qp2KrZiNixINir2KjYqiDaqdmG2YUg2K/YsSDYs9m+24zYr9in2LHYnw==' },
    @{ id='q13'; b64='2LPZiNivINqG2YLYr9ix2YfYnw==' },
    @{ id='q14'; b64='2YXZgtin24zYs9mHINqp2YY=' },
    @{ id='q15'; b64='2KjbjNmF2Ycg2K3ZgtmI2YIg2b7Ysdiz2YbZhCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw==' },
    @{ id='q16'; b64='2KfYs9iq2YfZhNin2qkg2YXYp9i024zZhuKAjNii2YTYp9iqINux27TbsNuy' },
    @{ id='q17'; b64='2YbYsdiuINio2KfYstiv2Ycg2LPYsdmF2KfbjNmH4oCM2q/YsNin2LHbjCDbsdu027Dbsg==' },
    @{ id='q18'; b64='2q/Ysdiv2LQg2K3Ys9in2Kgg2KLZgtin24wg2YXYuduM2YYg2YXYrdiz2YbbjCDZgdix2K8g27HbtNuw27I=' },
    @{ id='q19'; b64='2YXYp9mG2K/ZhyDYrdiz2KfYqCDYotmC2KfbjCDYudmE24wg2LHYttin24zbjCDbsdu027DbsiDahtmC2K/YsSDYp9iz2KrYnw==' },
    @{ id='q20'; b64='2YXYqNmE2Log27XbsNuw27DbsNuw27Ag2KrZiNmF2KfZhiDZhdin2YbYr9mHINiv2KfYsduM2YUg24zYpyDZhtmH2J8=' }
)

$results = @()
foreach ($q in $prompts) {
    Write-Host -NoNewline "[$($q.id)] ... "
    $alive = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if (-not $alive) {
        Write-Host "PROCESS_DEAD"
        $results += @{ id=$q.id; ok=$false; textLen=0; preview=""; error="process_dead" }
        continue
    }
    try {
        $body = @{ promptBase64 = $q.b64; requestId = "s31-$($q.id)-$(Get-Date -Format 'yyyyMMddHHmmss')"; conversationId = "s31-field-test" } | ConvertTo-Json -Compress
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:3322/ask" -Method Post -ContentType "application/json" -Headers @{"x-debug-token"="testtoken31"} -Body $body -TimeoutSec 120
        $textLen = 0
        $preview = ""
        if ($resp.result -and $resp.result.finalText) {
            $textLen = $resp.result.finalText.Length
            $preview = $resp.result.finalText.Substring(0, [Math]::Min(200, $textLen))
        }
        Write-Host "OK (len=$textLen)"
        $results += @{ id=$q.id; ok=$resp.ok; textLen=$textLen; preview=$preview }
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)"
        $results += @{ id=$q.id; ok=$false; textLen=0; preview=""; error=$_.Exception.Message }
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "=== Summary ==="
$okCount = ($results | Where-Object { $_.ok -eq $true }).Count
Write-Host "OK: $okCount / $($results.Count)"

$results | ConvertTo-Json -Depth 3 | Out-File -FilePath "C:\Users\Administrator\s31-field-test-results.json" -Encoding utf8
Write-Host "Results saved."
