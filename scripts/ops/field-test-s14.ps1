param(
  [string]$ServerHost = '192.168.85.56',
  [int]$Port = 2211,
  [string]$User = 'administrator',
  [string]$Password = 'Hs-co@12321#',
  [string]$DebugToken = 'accassist-ssh-debug-token'
)

$ErrorActionPreference = 'Stop'

$questions = @(
  # 5 document-oriented queries
  @{ id='q1'; prompt='سند شماره 1234 چیست؟'; expect='سند' },
  @{ id='q2'; prompt='جزئیات سند 5678 را نشان بده'; expect='سند' },
  @{ id='q3'; prompt='اسناد امروز چیست؟'; expect='سند' },
  @{ id='q4'; prompt='سندهای اختتامیه 1402'; expect='اختتامیه' },
  @{ id='q5'; prompt='سندهای افتتاحیه سال 1403'; expect='افتتاحیه' },
  # 3 anomaly detection
  @{ id='q6'; prompt='کدام سندها تراز نیستند؟'; expect='تراز' },
  @{ id='q7'; prompt='فاکتورهای مبلغ صفر کدامند؟'; expect='صفر' },
  @{ id='q8'; prompt='سندهای تکراری را پیدا کن'; expect='تکرار' },
  # 3 aging analysis
  @{ id='q9'; prompt='تحلیل سنی دریافتنی‌ها'; expect='دریافتنی' },
  @{ id='q10'; prompt='چقدر پرداختنی سررسید گذشته است؟'; expect='پرداختنی' },
  @{ id='q11'; prompt='دریافتنی‌های معوق کدامند؟'; expect='دریافتنی' },
  # 3 detailed turnover
  @{ id='q12'; prompt='گردش حساب 1001'; expect='گردش' },
  @{ id='q13'; prompt='گردش تفصیلی حساب بانک'; expect='گردش' },
  @{ id='q14'; prompt='گردش طرف حساب مشتری الف'; expect='گردش' },
  # 3 tax
  @{ id='q15'; prompt='مالیات فروش ماه 1403/05'; expect='مالیات' },
  @{ id='q16'; prompt='کدام فاکتورها مالیات ندارند؟'; expect='مالیات' },
  @{ id='q17'; prompt='مالیات بر ارزش افزوده قابل پرداخت چقدر است؟'; expect='ارزش افزوده' },
  # 3 checks
  @{ id='q18'; prompt='چک‌های دریافتی سررسید شده'; expect='چک' },
  @{ id='q19'; prompt='چک‌های برگشتی کدامند؟'; expect='چک' },
  @{ id='q20'; prompt='خلاصه چک‌های در جریان'; expect='چک' },
  # 3 period closing
  @{ id='q21'; prompt='وضعیت بستن دوره 1402'; expect='بستن' },
  @{ id='q22'; prompt='آیا تراز آزمایشی 1402 تراز است؟'; expect='تراز' },
  @{ id='q23'; prompt='مقایسه فروش 1402 و 1403'; expect='فروش' },
  # 3 reconciliation
  @{ id='q24'; prompt='تطبیق فروش با اسناد فروش'; expect='تطبیق' },
  @{ id='q25'; prompt='تطبیق خرید با اسناد خرید'; expect='تطبیق' },
  @{ id='q26'; prompt='تطبیق موجودی با اسناد انبار'; expect='تطبیق' },
  # 4 dateRange
  @{ id='q27'; prompt='فروش از 1403/05/01 تا 1403/05/31 چقدر است؟'; expect='فروش' },
  @{ id='q28'; prompt='فروش نیمه دوم سال 1403'; expect='فروش' },
  @{ id='q29'; prompt='فروش از فروردین تا مرداد 1403'; expect='فروش' },
  @{ id='q30'; prompt='فروش ماه 5 سال 1403'; expect='فروش' }
)

$results = @()
$okCount = 0

foreach ($q in $questions) {
  $promptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($q.prompt))

  $remoteScript = @"
`$ProgressPreference = 'SilentlyContinue'
`$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
`$prompt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$promptBase64'))

function New-DebugHeaders {
  param([string]`$Token)
  return @{ 'x-debug-token' = `$Token }
}

function Test-DebugEndpoint {
  param([string]`$Token)
  try {
    Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3322/health' -Headers (New-DebugHeaders -Token `$Token) -TimeoutSec 2 | Out-Null
    return `$true
  } catch {
    return `$false
  }
}

if (-not (Test-DebugEndpoint -Token '$DebugToken')) {
  `$env:ACC_ENABLE_AGENT_DEBUG_SERVER = '1'
  `$env:ACC_AGENT_DEBUG_TOKEN = '$DebugToken'
  `$exeCandidates = @(
    (Join-Path `$env:LOCALAPPDATA 'Programs\acc-assist\ACCAssist.exe'),
    (Join-Path `$env:LOCALAPPDATA 'Programs\ACC Assist\ACCAssist.exe'),
    'C:\Program Files\ACC Assist\ACCAssist.exe'
  )
  `$exe = `$exeCandidates | Where-Object { Test-Path `$_ } | Select-Object -First 1
  if (-not `$exe) { throw 'ACCAssist.exe not found' }
  Start-Process -FilePath `$exe -ArgumentList '--agent-debug-server-only'
  `$ready = `$false
  for (`$i = 0; `$i -lt 20; `$i++) {
    Start-Sleep -Seconds 1
    if (Test-DebugEndpoint -Token '$DebugToken') { `$ready = `$true; break }
  }
  if (-not `$ready) { throw 'Debug endpoint did not start' }
}

`$body = @{ prompt = `$prompt; mode = 'manual'; conversationId = 'field-test-s14' } | ConvertTo-Json -Depth 5
try {
  `$utf8Body = [Text.Encoding]::UTF8.GetBytes(`$body)
  `$response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3322/ask' -Headers (New-DebugHeaders -Token '$DebugToken') -Body `$utf8Body -ContentType 'application/json; charset=utf-8'
  `$payload = [pscustomobject]@{
    Ok = [bool]`$response.ok
    RequestId = [string]`$response.requestId
    FinalTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]`$response.result.finalText))
    ErrorTextBase64 = ''
  }
} catch {
  `$errorMessage = if (`$_.ErrorDetails -and `$_.ErrorDetails.Message) { [string]`$_.ErrorDetails.Message } else { [string]`$_.Exception.Message }
  `$payload = [pscustomobject]@{
    Ok = `$false
    RequestId = ''
    FinalTextBase64 = ''
    ErrorTextBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(`$errorMessage))
  }
}
Write-Output '__ACC_ASSIST_JSON_BEGIN__'
Write-Output (`$payload | ConvertTo-Json -Compress)
Write-Output '__ACC_ASSIST_JSON_END__'
"@

  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
  Write-Host "[$($q.id)] Sending: $($q.prompt)" -NoNewline

  try {
    $rawOutput = plink -P $Port -ssh -batch -pw $Password "${User}@${ServerHost}" "powershell -NoProfile -EncodedCommand $encoded" 2>&1 | Out-String

    if ($rawOutput -match '__ACC_ASSIST_JSON_BEGIN__\s*(\{.+?\})\s*__ACC_ASSIST_JSON_END__') {
      $payload = $Matches[1] | ConvertFrom-Json
      $finalText = if ([string]::IsNullOrWhiteSpace([string]$payload.FinalTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.FinalTextBase64)) }
      $errorText = if ([string]::IsNullOrWhiteSpace([string]$payload.ErrorTextBase64)) { '' } else { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$payload.ErrorTextBase64)) }

      $isOk = [bool]$payload.Ok
      $verdict = if ($isOk -and $finalText -notmatch 'error|خطا|نمی‌توانم') { 'ok' } else { 'fail' }

      if ($verdict -eq 'ok') {
        $okCount++
        Write-Host " -> OK (reqId: $($payload.RequestId))" -ForegroundColor Green
      } else {
        Write-Host " -> FAIL (reqId: $($payload.RequestId))" -ForegroundColor Red
        if ($errorText) { Write-Host "  Error: $errorText" -ForegroundColor Yellow }
      }

      $results += [pscustomobject]@{
        Id = $q.id
        Prompt = $q.prompt
        Ok = $isOk
        Verdict = $verdict
        RequestId = $payload.RequestId
        FinalTextLen = $finalText.Length
        ErrorText = $errorText
      }
    } else {
      Write-Host " -> PARSE FAIL" -ForegroundColor Red
      $results += [pscustomobject]@{
        Id = $q.id
        Prompt = $q.prompt
        Ok = $false
        Verdict = 'parse-fail'
        RequestId = ''
        FinalTextLen = 0
        ErrorText = $rawOutput.Substring(0, [Math]::Min(200, $rawOutput.Length))
      }
    }
  } catch {
    Write-Host " -> EXCEPTION: $($_.Exception.Message)" -ForegroundColor Red
    $results += [pscustomobject]@{
      Id = $q.id
      Prompt = $q.prompt
      Ok = $false
      Verdict = 'exception'
      RequestId = ''
      FinalTextLen = 0
      ErrorText = $_.Exception.Message
    }
  }

  Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "=== FIELD TEST S14 RESULTS ==="
Write-Host "Total: $($results.Count)"
Write-Host "OK: $okCount / $($results.Count)"
Write-Host ""
$results | Format-Table Id, Verdict, RequestId, FinalTextLen -AutoSize
