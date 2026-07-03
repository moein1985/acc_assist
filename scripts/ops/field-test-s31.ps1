$questions = @(
    @{ id='q1'; prompt='فروش ۱۴۰۲ چقدر است؟' },
    @{ id='q2'; prompt='ترازنامه ۱۴۰۲' },
    @{ id='q3'; prompt='سود خالص ۱۴۰۲' },
    @{ id='q4'; prompt='مانده بانکی ۱۴۰۲' },
    @{ id='q5'; prompt='هزینه‌های پرسنلی ۱۴۰۲' },
    @{ id='q6'; prompt='دریافتنی‌های ۱۴۰۲' },
    @{ id='q7'; prompt='پرداختنی‌های ۱۴۰۲' },
    @{ id='q8'; prompt='بهای تمام شده ۱۴۰۲' },
    @{ id='q9'; prompt='هوای تهران امروز چطور است؟' },
    @{ id='q10'; prompt='قیمت طلا در بازار چقدر است؟' },
    @{ id='q11'; prompt='تعداد کارمندان شرکت چقدر است؟' },
    @{ id='q12'; prompt='چطور فاکتور ثبت کنم در سپیدار؟' },
    @{ id='q13'; prompt='سود چقدره؟' },
    @{ id='q14'; prompt='مقایسه کن' },
    @{ id='q15'; prompt='بیمه حقوق پرسنل ۱۴۰۲ چقدر است؟' },
    @{ id='q16'; prompt='استهلاک ماشین‌آلات ۱۴۰۲' },
    @{ id='q17'; prompt='نرخ بازده سرمایه‌گذاری ۱۴۰۲' },
    @{ id='q18'; prompt='گردش حساب آقای معین محسنی فرد ۱۴۰۲' },
    @{ id='q19'; prompt='مانده حساب آقای علی رضایی ۱۴۰۲ چقدر است؟' },
    @{ id='q20'; prompt='مبلغ ۵۰۰۰۰۰۰ تومان مانده داریم یا نه؟' }
)

$results = @()
foreach ($q in $questions) {
    Write-Host -NoNewline "[$($q.id)] Asking: $($q.prompt) ... "
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($q.prompt)
        $b64 = [Convert]::ToBase64String($bytes)
        $body = @{ promptBase64 = $b64; requestId = "s31-$($q.id)-$(Get-Date -Format 'yyyyMMddHHmmss')"; conversationId = "s31-field-test" } | ConvertTo-Json -Compress
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:3322/ask" -Method Post -ContentType "application/json" -Headers @{"x-debug-token"="testtoken31"} -Body $body -TimeoutSec 120
        $textLen = if ($resp.result.finalText) { $resp.result.finalText.Length } else { 0 }
        $preview = if ($textLen -gt 0) { $resp.result.finalText.Substring(0, [Math]::Min(150, $textLen)) } else { "" }
        Write-Host "OK (len=$textLen)"
        Write-Host "  -> $preview"
        $results += @{ id=$q.id; prompt=$q.prompt; ok=$resp.ok; textLen=$textLen; preview=$preview }
    } catch {
        $errMsg = $_.Exception.Message
        Write-Host "ERROR: $errMsg"
        $results += @{ id=$q.id; prompt=$q.prompt; ok=$false; textLen=0; preview=""; error=$errMsg }
    }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "=== Summary ==="
$okCount = ($results | Where-Object { $_.ok -eq $true }).Count
$failCount = ($results | Where-Object { $_.ok -ne $true }).Count
Write-Host "OK: $okCount / $($results.Count)"
Write-Host "FAIL/REFUSE: $failCount / $($results.Count)"

$resultsJson = $results | ConvertTo-Json -Depth 3
$resultsJson | Out-File -FilePath "C:\Users\Administrator\s31-field-test-results.json" -Encoding utf8
Write-Host "Results saved to C:\Users\Administrator\s31-field-test-results.json"
