# S36.4 — Unit test for strict matching function
# Tests the 6 cases from the Phase 36 audit table — all must produce match=false
# Run: powershell -ExecutionPolicy Bypass -File scripts/ops/test-match-function.ps1

$ErrorActionPreference = 'Stop'

function Test-MatchFunction {
  param(
    [string]$TestName,
    [hashtable]$MetricDef,
    [hashtable]$Engine,
    [double]$Oracle,
    [bool]$ExpectedMatch,
    [string]$ExpectedReasonPattern
  )

  $engineNum = $null
  $engineMetricId = $null
  $matchReason = ''

  if ($Engine -and $Engine.ok) {
    $normalized = $Engine.text -replace '[\u06F0-\u06F9]', { [string]([int][char]$_.Value[0] - 0x06F0 + 0x30) }
    $normalized = $normalized -replace '[\u0660-\u0669]', { [string]([int][char]$_.Value[0] - 0x0660 + 0x30) }
    $normalized = $normalized -replace '[, ]', ''

    $metricIdMatch = [regex]::Match($normalized, 'metricId=(\w+)')
    if ($metricIdMatch.Success) {
      $engineMetricId = $metricIdMatch.Groups[1].Value
    }

    $summaryMatch = [regex]::Match($normalized, '###Summary(.+?)(###|$)')
    $searchText = $normalized
    if ($summaryMatch.Success) {
      $searchText = $summaryMatch.Groups[1].Value
    } else {
      $evidenceIdx = $searchText.IndexOf('###Evidence')
      if ($evidenceIdx -ge 0) {
        $searchText = $searchText.Substring(0, $evidenceIdx)
      }
    }

    $allMatches = [regex]::Matches($searchText, '[0-9]{1,}')
    if ($allMatches.Count -ge 1) {
      $best = $null
      foreach ($numMatch in $allMatches) {
        $val = [double]$numMatch.Value
        if ($val -ge 1300 -and $val -le 1499) { continue }
        if ($best -eq $null -or $numMatch.Value.Length -gt $best.Length) {
          $best = $numMatch.Value
        }
      }
      if ($best -eq $null) {
        $best = $allMatches[0].Value
        foreach ($numMatch in $allMatches) {
          if ($numMatch.Value.Length -gt $best.Length) { $best = $numMatch.Value }
        }
      }
      if ($best -ne $null) {
        $engineNum = [double]$best
      }
    }
  }

  $match = $false
  $matchReason = 'unknown'

  if (-not $Engine -or -not $Engine.ok) {
    $match = $false
    $matchReason = if ($Engine -and -not $Engine.ok) { 'engine_error' } else { 'no_response' }
  } elseif ($engineMetricId -and $engineMetricId -ne $MetricDef.expectedMetricId) {
    $match = $false
    $matchReason = "wrong_metric:engine=$engineMetricId expected=$($MetricDef.expectedMetricId)"
  } elseif (-not $engineMetricId) {
    $match = $false
    $matchReason = 'model_prose: no metricId in evidence'
  } elseif ($MetricDef.expected -eq -1) {
    $hasSummary = $Engine.text -match '### Summary'
    if ($hasSummary -and $engineNum -ne $null -and $engineNum -gt 0) {
      $match = $true
      $matchReason = 'list_with_data'
    } elseif ($hasSummary) {
      $match = $true
      $matchReason = 'list_empty_valid'
    } else {
      $match = $false
      $matchReason = 'list_no_summary: engine did not produce structured data'
    }
  } elseif ($Oracle -ne $null -and $engineNum -ne $null -and ($Oracle -is [double] -or $Oracle -is [int])) {
    $diff = [Math]::Abs($Oracle - $engineNum)
    $tolerance = [Math]::Max(1, [Math]::Abs($Oracle) * 0.001)
    if ($diff -le $tolerance) {
      $match = $true
      $matchReason = 'numeric_match'
    } else {
      $absDiff = [Math]::Abs([Math]::Abs($Oracle) - [Math]::Abs($engineNum))
      if ($absDiff -le $tolerance) {
        $match = $true
        $matchReason = 'numeric_match_abs'
      } else {
        $match = $false
        $matchReason = "numeric_diff: engine=$engineNum oracle=$Oracle diff=$diff"
      }
    }
  } else {
    $match = $false
    $matchReason = if ($engineNum -eq $null) { 'no_number_extracted' } else { 'oracle_unavailable' }
  }

  $pass = $false
  if ($match -eq $ExpectedMatch) {
    if (-not $ExpectedReasonPattern -or $matchReason -match $ExpectedReasonPattern) {
      $pass = $true
    }
  }

  $status = if ($pass) { 'PASS' } else { 'FAIL' }
  $color = if ($pass) { 'Green' } else { 'Red' }
  Write-Host "  [$status] $TestName" -ForegroundColor $color
  if (-not $pass) {
    Write-Host "    Expected: match=$ExpectedMatch, reason~/$ExpectedReasonPattern/" -ForegroundColor Red
    Write-Host "    Got:      match=$match, reason='$matchReason'" -ForegroundColor Red
    Write-Host "    engineMetricId=$engineMetricId, engineNum=$engineNum" -ForegroundColor Red
  }

  return $pass
}

# ─── Test Cases (from S36.0 table) ───
# Using ASCII-only engine text to avoid encoding issues

$tests = @()

# Case 1: vat_liability — engine serves vat_detailed (wrong metric)
$tests += @{
  Name = 'vat_liability: wrong_metric (vat_detailed instead of vat_liability)'
  Metric = @{ id='vat_liability'; expectedMetricId='vat_liability'; expected=0 }
  Engine = @{ ok=$true; text="### Summary`nAmount: 355590636679`n`n### Findings`n- Source: engine`n- Amount: 355590636679`n`n### Evidence`n- Evidence: Financial Engine (metricId=vat_detailed)`n- SQL: SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice" }
  Oracle = 2029051751
  ExpectedMatch = $false
  ExpectedReason = 'wrong_metric'
}

# Case 2: total_liabilities — engine serves payables (wrong metric)
$tests += @{
  Name = 'total_liabilities: wrong_metric (payables instead of total_liabilities)'
  Metric = @{ id='total_liabilities'; expectedMetricId='total_liabilities'; expected=0 }
  Engine = @{ ok=$true; text="### Summary`nAmount: 26058866504`n`n### Findings`n- Source: engine`n- Amount: 26058866504`n`n### Evidence`n- Evidence: Financial Engine (metricId=payables)`n- SQL: SELECT SUM(Debit-Credit) FROM ..." }
  Oracle = -26058866504
  ExpectedMatch = $false
  ExpectedReason = 'wrong_metric'
}

# Case 3: recent_documents — engine refusal but ok=true (no metricId)
$tests += @{
  Name = 'recent_documents: engine refusal (no metricId in evidence)'
  Metric = @{ id='recent_documents'; expectedMetricId='recent_documents'; expected=-1 }
  Engine = @{ ok=$true; text="I do not have reliable data for this query. Please refine your question." }
  Oracle = 49158
  ExpectedMatch = $false
  ExpectedReason = 'model_prose'
}

# Case 4: fiscal_year_list — engine gives dictionary definition (no metricId)
$tests += @{
  Name = 'fiscal_year_list: model prose (dictionary definition, no metricId)'
  Metric = @{ id='fiscal_year_list'; expectedMetricId='fiscal_year_list'; expected=-1 }
  Engine = @{ ok=$true; text="A fiscal year is a 12-month period used for accounting purposes. Fiscal years typically start in spring." }
  Oracle = 3
  ExpectedMatch = $false
  ExpectedReason = 'model_prose'
}

# Case 5: unbalanced_vouchers — engine gives dictionary (no Summary, no metricId)
$tests += @{
  Name = 'unbalanced_vouchers: model prose (no Summary, no metricId)'
  Metric = @{ id='unbalanced_vouchers'; expectedMetricId='unbalanced_vouchers'; expected=-1 }
  Engine = @{ ok=$true; text="Unbalanced vouchers are vouchers where debits do not equal credits. This is an accounting integrity issue." }
  Oracle = 0
  ExpectedMatch = $false
  ExpectedReason = 'model_prose'
}

# Case 6: cogs — correct metricId but value differs from oracle
$tests += @{
  Name = 'cogs: correct metricId but numeric_diff (engine=11B, oracle=5B)'
  Metric = @{ id='cogs'; expectedMetricId='cogs'; expected=0 }
  Engine = @{ ok=$true; text="### Summary`nAmount: 11028549876`n`n### Findings`n- Source: engine`n- Amount: 11028549876`n`n### Evidence`n- Evidence: Financial Engine (metricId=cogs)`n- SQL: SELECT SUM(Debit-Credit) FROM ..." }
  Oracle = 5000000000
  ExpectedMatch = $false
  ExpectedReason = 'numeric_diff'
}

# ─── Run tests ───
Write-Host '=== S36.4 — Match Function Unit Tests ===' -ForegroundColor Cyan
Write-Host "Running $($tests.Count) test cases..."
Write-Host ''

$passCount = 0
$failCount = 0
foreach ($t in $tests) {
  $result = Test-MatchFunction -TestName $t.Name -MetricDef $t.Metric -Engine $t.Engine -Oracle $t.Oracle -ExpectedMatch $t.ExpectedMatch -ExpectedReasonPattern $t.ExpectedReason
  if ($result) { $passCount++ } else { $failCount++ }
}

Write-Host ''
Write-Host "=== RESULTS ===" -ForegroundColor Cyan
Write-Host "Pass: $passCount / $($tests.Count)"
Write-Host "Fail: $failCount / $($tests.Count)"

if ($failCount -gt 0) {
  Write-Host "FAILED — some test cases did not produce expected result" -ForegroundColor Red
  exit 1
} else {
  Write-Host "ALL PASS — all false-match cases correctly rejected" -ForegroundColor Green
  exit 0
}
