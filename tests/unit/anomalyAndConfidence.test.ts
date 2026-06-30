import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  detectAnomalies,
  type AnomalyDetectionContext
} from '../../src/main/services/financialEngine/anomalyDetector'
import {
  computeConfidenceScore,
  getConfidenceBadgeClass,
  getConfidenceLabel,
  type ConfidenceFactors
} from '../../src/main/services/financialEngine/confidenceScore'
import type { MetricPlan } from '../../src/main/services/financialEngine/types'

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeCtx(
  metricId: string,
  rows: Record<string, unknown>[],
  grain: string = 'total'
): AnomalyDetectionContext {
  return {
    metricId: metricId as any,
    rows,
    plan: { metricId: metricId as any, grain: grain as any, filters: [], confidence: 0.9 } as MetricPlan
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AnomalyDetector — Year-over-Year Change
// ═══════════════════════════════════════════════════════════════════════════════

test('anomaly: 50% YoY change triggers medium severity anomaly', () => {
  const rows = [
    { year: 1402, amount: 100000000 },
    { year: 1403, amount: 150000000 }
  ]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoy = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.ok(yoy, 'should detect 50% change')
  assert.equal(yoy!.severity, 'medium')
  assert.ok(yoy!.description.includes('افزایش'), 'should mention increase direction')
})

test('anomaly: 80% YoY decrease triggers high severity', () => {
  const rows = [
    { year: 1402, amount: 100000000 },
    { year: 1403, amount: 20000000 }
  ]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoy = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.ok(yoy, 'should detect 80% decrease')
  assert.equal(yoy!.severity, 'high')
  assert.ok(yoy!.description.includes('کاهش'), 'should mention decrease direction')
})

test('anomaly: <50% change does not trigger anomaly', () => {
  const rows = [
    { year: 1402, amount: 100000000 },
    { year: 1403, amount: 130000000 }
  ]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoy = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.equal(yoy, undefined, '30% change should not trigger anomaly')
})

test('anomaly: single row does not trigger YoY anomaly', () => {
  const rows = [{ year: 1402, amount: 100000000 }]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoy = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.equal(yoy, undefined, 'single row should not trigger YoY')
})

test('anomaly: zero previous amount skipped (no division by zero)', () => {
  const rows = [
    { year: 1402, amount: 0 },
    { year: 1403, amount: 100000000 }
  ]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoy = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.equal(yoy, undefined, 'should skip when previous amount is zero')
})

test('anomaly: Persian column names (sal, mandeh) work for YoY', () => {
  const rows = [
    { sal: 1401, mandeh: 50000000 },
    { sal: 1402, mandeh: 90000000 }
  ]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoy = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.ok(yoy, 'should detect with Persian column names')
  assert.equal(yoy!.severity, 'high', '80% change should be high')
})

test('anomaly: multi-year rows detect multiple YoY anomalies', () => {
  const rows = [
    { year: 1400, amount: 100000000 },
    { year: 1401, amount: 160000000 },
    { year: 1402, amount: 240000000 }
  ]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoyAnomalies = anomalies.filter((a) => a.type === 'year_over_year_change')
  assert.equal(yoyAnomalies.length, 2, 'should detect 2 transitions')
})

// ═══════════════════════════════════════════════════════════════════════════════
// AnomalyDetector — Balance Mismatch
// ═══════════════════════════════════════════════════════════════════════════════

test('anomaly: zero balance with many vouchers triggers balance_mismatch', () => {
  const rows = [
    { balance: 0, count: 15, name: 'حساب تست' }
  ]
  const anomalies = detectAnomalies(makeCtx('account_turnover', rows))
  const mismatch = anomalies.find((a) => a.type === 'balance_mismatch')
  assert.ok(mismatch, 'should detect zero balance with many vouchers')
  assert.equal(mismatch!.severity, 'medium')
  assert.ok(mismatch!.description.includes('سند'), 'should mention vouchers')
})

test('anomaly: large balance with few vouchers triggers low severity mismatch', () => {
  const rows = [
    { balance: 500000000, count: 1, name: 'حساب بزرگ' }
  ]
  const anomalies = detectAnomalies(makeCtx('account_turnover', rows))
  const mismatch = anomalies.find(
    (a) => a.type === 'balance_mismatch' && a.severity === 'low'
  )
  assert.ok(mismatch, 'should detect large balance with few vouchers')
  assert.ok(mismatch!.description.includes('مانده بزرگ'), 'should mention large balance')
})

test('anomaly: normal balance with normal voucher count does not trigger mismatch', () => {
  const rows = [
    { balance: 5000000, count: 50, name: 'حساب عادی' }
  ]
  const anomalies = detectAnomalies(makeCtx('account_turnover', rows))
  const mismatch = anomalies.find((a) => a.type === 'balance_mismatch')
  assert.equal(mismatch, undefined, 'normal balance/voucher ratio should not trigger')
})

// ═══════════════════════════════════════════════════════════════════════════════
// AnomalyDetector — Unusual Voucher (3σ)
// ═══════════════════════════════════════════════════════════════════════════════

test('anomaly: outlier amount >3σ from mean triggers unusual_voucher', () => {
  const amounts = [100, 105, 98, 103, 110, 95, 102, 107, 99, 101, 5000]
  const rows = amounts.map((amount) => ({ amount }))
  const anomalies = detectAnomalies(makeCtx('voucher_detail', rows))
  const unusual = anomalies.find((a) => a.type === 'unusual_voucher')
  assert.ok(unusual, 'should detect outlier')
  assert.equal(unusual!.severity, 'high')
  assert.ok((unusual!.data['zScore'] as number) >= 3)
})

test('anomaly: uniform amounts do not trigger unusual_voucher (stdDev=0)', () => {
  const rows = Array.from({ length: 10 }, () => ({ amount: 1000 }))
  const anomalies = detectAnomalies(makeCtx('voucher_detail', rows))
  const unusual = anomalies.find((a) => a.type === 'unusual_voucher')
  assert.equal(unusual, undefined, 'uniform amounts should not trigger')
})

test('anomaly: fewer than 4 rows does not trigger unusual_voucher', () => {
  const rows = [
    { amount: 100 },
    { amount: 200 },
    { amount: 1000000 }
  ]
  const anomalies = detectAnomalies(makeCtx('voucher_detail', rows))
  const unusual = anomalies.find((a) => a.type === 'unusual_voucher')
  assert.equal(unusual, undefined, 'need >=4 rows for meaningful statistics')
})

// ═══════════════════════════════════════════════════════════════════════════════
// AnomalyDetector — No Activity Account
// ═══════════════════════════════════════════════════════════════════════════════

test('anomaly: balance >1000 with zero vouchers triggers no_activity_account', () => {
  const rows = [
    { balance: 5000000, count: 0, name: 'حساب خواب‌شده' }
  ]
  const anomalies = detectAnomalies(makeCtx('account_turnover', rows))
  const noActivity = anomalies.find((a) => a.type === 'no_activity_account')
  assert.ok(noActivity, 'should detect no-activity account')
  assert.equal(noActivity!.severity, 'low')
  assert.ok(noActivity!.description.includes('حساب'), 'should mention account name')
  assert.ok(noActivity!.description.includes('حساب خواب‌شده'), 'should include account name in description')
})

test('anomaly: balance <1000 with zero vouchers does not trigger', () => {
  const rows = [
    { balance: 500, count: 0, name: 'حساب کوچک' }
  ]
  const anomalies = detectAnomalies(makeCtx('account_turnover', rows))
  const noActivity = anomalies.find((a) => a.type === 'no_activity_account')
  assert.equal(noActivity, undefined, 'small balance should not trigger')
})

test('anomaly: balance with vouchers does not trigger no_activity', () => {
  const rows = [
    { balance: 5000000, count: 10, name: 'حساب فعال' }
  ]
  const anomalies = detectAnomalies(makeCtx('account_turnover', rows))
  const noActivity = anomalies.find((a) => a.type === 'no_activity_account')
  assert.equal(noActivity, undefined, 'active account should not trigger')
})

// ═══════════════════════════════════════════════════════════════════════════════
// AnomalyDetector — Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

test('anomaly: empty rows returns no anomalies', () => {
  const anomalies = detectAnomalies(makeCtx('net_sales', []))
  assert.equal(anomalies.length, 0)
})

test('anomaly: rows with no recognizable columns returns no anomalies', () => {
  const rows = [{ foo: 'bar', baz: 42 }]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows))
  assert.equal(anomalies.length, 0)
})

test('anomaly: rows with NaN values are safely skipped', () => {
  const rows = [
    { year: 'invalid', amount: 'not-a-number' },
    { year: 1402, amount: 100 },
    { year: 1403, amount: 200 }
  ]
  const anomalies = detectAnomalies(makeCtx('net_sales', rows, 'by_year'))
  const yoy = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.ok(yoy, 'should still detect from valid rows')
})

test('anomaly: Persian column name (tedad) works for count detection', () => {
  const rows = [
    { mandeh: 0, tedad: 20, hesab: 'حساب تست' }
  ]
  const anomalies = detectAnomalies(makeCtx('account_turnover', rows))
  const mismatch = anomalies.find((a) => a.type === 'balance_mismatch')
  assert.ok(mismatch, 'should detect with Persian column names (tedad, mandeh)')
})

// ═══════════════════════════════════════════════════════════════════════════════
// ConfidenceScore — computeConfidenceScore
// ═══════════════════════════════════════════════════════════════════════════════

test('confidence: perfect factors → score 100', () => {
  const factors: ConfidenceFactors = {
    sqlRowsReturned: true,
    evidenceMatch: true,
    anomalyDetected: false,
    planConfidence: 'high',
    fallbackUsed: false
  }
  const result = computeConfidenceScore(factors)
  assert.equal(result.score, 100)
  assert.equal(result.factors, factors)
})

test('confidence: no rows returned → score 60 (-40)', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: false,
    evidenceMatch: true,
    anomalyDetected: false,
    planConfidence: 'high',
    fallbackUsed: false
  })
  assert.equal(result.score, 60)
})

test('confidence: no evidence match → score 80 (-20)', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: false,
    anomalyDetected: false,
    planConfidence: 'high',
    fallbackUsed: false
  })
  assert.equal(result.score, 80)
})

test('confidence: anomaly detected → score 90 (-10)', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: true,
    anomalyDetected: true,
    planConfidence: 'high',
    fallbackUsed: false
  })
  assert.equal(result.score, 90)
})

test('confidence: medium plan confidence → score 90 (-10)', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: true,
    anomalyDetected: false,
    planConfidence: 'medium',
    fallbackUsed: false
  })
  assert.equal(result.score, 90)
})

test('confidence: low plan confidence → score 75 (-25)', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: true,
    anomalyDetected: false,
    planConfidence: 'low',
    fallbackUsed: false
  })
  assert.equal(result.score, 75)
})

test('confidence: fallback used → score 80 (-20)', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: true,
    anomalyDetected: false,
    planConfidence: 'high',
    fallbackUsed: true
  })
  assert.equal(result.score, 80)
})

test('confidence: worst case all penalties → score 0', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: false,
    evidenceMatch: false,
    anomalyDetected: true,
    planConfidence: 'low',
    fallbackUsed: true
  })
  assert.equal(result.score, 0)
})

test('confidence: score is clamped to max 100', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: true,
    anomalyDetected: false,
    planConfidence: 'high',
    fallbackUsed: false
  })
  assert.ok(result.score <= 100, 'score should not exceed 100')
})

test('confidence: score is clamped to min 0', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: false,
    evidenceMatch: false,
    anomalyDetected: true,
    planConfidence: 'low',
    fallbackUsed: true
  })
  assert.ok(result.score >= 0, 'score should not go below 0')
})

test('confidence: combined medium plan + no rows + no evidence → score 30', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: false,
    evidenceMatch: false,
    anomalyDetected: false,
    planConfidence: 'medium',
    fallbackUsed: false
  })
  assert.equal(result.score, 30) // 100 - 40 - 20 - 10 = 30
})

test('confidence: combined low plan + fallback + no evidence → score 35', () => {
  const result = computeConfidenceScore({
    sqlRowsReturned: true,
    evidenceMatch: false,
    anomalyDetected: false,
    planConfidence: 'low',
    fallbackUsed: true
  })
  assert.equal(result.score, 35) // 100 - 20 - 25 - 20 = 35
})

// ═══════════════════════════════════════════════════════════════════════════════
// ConfidenceScore — getConfidenceBadgeClass
// ═══════════════════════════════════════════════════════════════════════════════

test('badge: score >=80 → confidence-high', () => {
  assert.equal(getConfidenceBadgeClass(80), 'confidence-high')
  assert.equal(getConfidenceBadgeClass(95), 'confidence-high')
  assert.equal(getConfidenceBadgeClass(100), 'confidence-high')
})

test('badge: score 50-79 → confidence-medium', () => {
  assert.equal(getConfidenceBadgeClass(50), 'confidence-medium')
  assert.equal(getConfidenceBadgeClass(65), 'confidence-medium')
  assert.equal(getConfidenceBadgeClass(79), 'confidence-medium')
})

test('badge: score <50 → confidence-low', () => {
  assert.equal(getConfidenceBadgeClass(0), 'confidence-low')
  assert.equal(getConfidenceBadgeClass(25), 'confidence-low')
  assert.equal(getConfidenceBadgeClass(49), 'confidence-low')
})

// ═══════════════════════════════════════════════════════════════════════════════
// ConfidenceScore — getConfidenceLabel
// ═══════════════════════════════════════════════════════════════════════════════

test('label: score >=80 → بالا', () => {
  assert.equal(getConfidenceLabel(80), 'بالا')
  assert.equal(getConfidenceLabel(100), 'بالا')
})

test('label: score 50-79 → متوسط', () => {
  assert.equal(getConfidenceLabel(50), 'متوسط')
  assert.equal(getConfidenceLabel(79), 'متوسط')
})

test('label: score <50 → پایین', () => {
  assert.equal(getConfidenceLabel(0), 'پایین')
  assert.equal(getConfidenceLabel(49), 'پایین')
})
