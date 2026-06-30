/**
 * S21.14 — Phase 21 Unit Tests (7 tests)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computeConfidenceScore, getConfidenceBadgeClass } from '../../src/main/services/financialEngine/confidenceScore'
import { ReportScheduler } from '../../src/main/services/reportScheduler'
import { detectQueryLanguage } from '../../src/main/services/financialEngine/planner'
import { routeMetric } from '../../src/main/services/financialEngine/router'
import type { ScheduledReport } from '../../src/shared/contracts'

// S21.14.3-S21.14.4: Chart auto-selection logic (inlined to avoid renderer import in node tests)
function autoSelectChartTypeLogic(labels: string[], values: number[]): 'line' | 'bar' | 'doughnut' {
  if (labels.length <= 6 && values.every((v) => v > 0)) {
    const sum = values.reduce((a, b) => a + b, 0)
    if (sum > 0 && values.every((v) => v / sum <= 0.5)) {
      return 'doughnut'
    }
  }
  const yearLike = labels.every((l) => /^\d{4}$/.test(l.trim()) || /^(14|13)\d{2}$/.test(l.trim()))
  if (yearLike) {
    return 'line'
  }
  return 'bar'
}

// ─── Test 1: ConfidenceScore — 0 rows → low score ──────────────────────────

test('S21.14.1: ConfidenceScore with 0 rows returns low score', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: false,
    evidenceMatch: false,
    anomalyDetected: false,
    planConfidence: 'low',
    fallbackUsed: true
  })
  assert.ok(result.score < 50, `Expected score < 50, got ${result.score}`)
  assert.ok(result.score >= 0)
})

// ─── Test 2: ConfidenceScore — evidence match → high score ─────────────────

test('S21.14.2: ConfidenceScore with evidence match returns high score', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: true,
    anomalyDetected: false,
    planConfidence: 'high',
    fallbackUsed: false
  })
  assert.equal(result.score, 100)
  assert.equal(getConfidenceBadgeClass(result.score), 'confidence-high')
})

// ─── Test 3: Chart auto-selection — time series → line ──────────────────────

test('S21.14.3: Chart auto-selection: year labels → line chart', () => {
  const chartType = autoSelectChartTypeLogic(['1400', '1401', '1402', '1403'], [100, 200, 300, 800])
  assert.equal(chartType, 'line')
})

// ─── Test 4: Chart auto-selection — categorical → bar ───────────────────────

test('S21.14.4: Chart auto-selection: categorical labels → bar chart', () => {
  const chartType = autoSelectChartTypeLogic(['شرکت الف', 'شرکت ب', 'شرکت ج'], [3000, 1000, 500])
  assert.equal(chartType, 'bar')
})

// ─── Test 5: ReportScheduler — daily schedule starts timer ──────────────────

test('S21.14.5: ReportScheduler starts timer for daily enabled report', () => {
  const logs: string[] = []
  let executed = false
  const reports: ScheduledReport[] = [
    {
      id: 'test-1',
      name: 'Test Daily',
      prompt: 'فروش چقدر است؟',
      schedule: { frequency: 'daily', time: '09:00' },
      outputFormat: 'text',
      delivery: 'save',
      enabled: true
    }
  ]
  const scheduler = new ReportScheduler({
    executeReport: async () => { executed = true },
    getReports: () => reports,
    log: (msg) => logs.push(msg)
  })
  scheduler.start()
  assert.ok(logs.some((l) => l.includes('started with 1 active timer')))
  assert.equal(executed, false)
  scheduler.stopAll()
})

// ─── Test 6: English query — "total sales 1402" routes to net_sales ─────────

test('S21.14.6: English query "total sales" routes to net_sales', () => {
  const result = routeMetric('total sales in 1402', 'sepidar')
  assert.equal(result.metricId, 'net_sales')
  assert.ok(result.confidence >= 0.7)
})

// ─── Test 7: detectQueryLanguage — mixed language detection ─────────────────

test('S21.14.7: detectQueryLanguage correctly identifies English vs Persian', () => {
  assert.equal(detectQueryLanguage('What were total sales in 1402?'), 'en')
  assert.equal(detectQueryLanguage('فروش سال 1402 چقدر است؟'), 'fa')
  assert.equal(detectQueryLanguage('total expenses سال 1402'), 'en')
})
