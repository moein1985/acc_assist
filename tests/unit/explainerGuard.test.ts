import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  composeEngineResponseMarkdown,
  composeMultiMetricMarkdown,
  composeMultiStepMarkdown
} from '../../src/main/services/financialEngine/explainer'
import type {
  EngineResult,
  MetricPlan,
  EngineVerdict
} from '../../src/main/services/financialEngine/types'
import type { MultiMetricResult, MultiStepResult } from '../../src/main/services/financialEngine/index'

function makeResult(value: number | null): EngineResult {
  const rows = value !== null ? [{ result_value: value }] : []
  return {
    rows,
    plan: makePlan('net_sales'),
    compiled: { sql: 'SELECT 1', bindingsDescription: 'none' }
  }
}

function makePlan(metricId: string): MetricPlan {
  return {
    metricId: metricId as MetricPlan['metricId'],
    grain: 'total',
    filters: [],
    confidence: 1.0
  }
}

function makeFailedVerdict(reason: string): EngineVerdict {
  return { ok: false, reason, reconciliations: [] }
}

function makeOkVerdict(): EngineVerdict {
  return { ok: true, reconciliations: [] }
}

test('S23.7 — composeEngineResponseMarkdown: failed verdict produces no numbers', () => {
  const result = makeResult(64252437897)
  const verdict = makeFailedVerdict('insufficient-evidence')
  const output = composeEngineResponseMarkdown(result, verdict, 'فروش ۱۴۰۲')

  assert.ok(output.includes('پاسخ قابل ارائه نیست'), 'should contain rejection message')
  assert.ok(!output.includes('64252437897'), 'must NOT contain the raw number')
  assert.ok(!output.includes('64,252,437,897'), 'must NOT contain the formatted number')
  assert.ok(output.includes('Verifier: failed'), 'should mention verifier failed')
})

test('S23.7 — composeEngineResponseMarkdown: ok verdict produces numbers', () => {
  const result = makeResult(64252437897)
  const verdict = makeOkVerdict()
  const output = composeEngineResponseMarkdown(result, verdict, 'فروش ۱۴۰۲')

  assert.ok(output.includes('64,252,437,897'), 'should contain the formatted number')
  assert.ok(!output.includes('پاسخ قابل ارائه نیست'), 'should NOT contain rejection message')
})

test('S23.7 — composeMultiMetricMarkdown: any failed verdict produces no numbers', () => {
  const multiResult: MultiMetricResult = {
    results: [makeResult(100), makeResult(200)],
    verdicts: [makeOkVerdict(), makeFailedVerdict('reconciliation-failed: non_neg')],
    plan: { joinMode: 'side_by_side', metricIds: ['net_sales', 'purchases'] }
  } as unknown as MultiMetricResult

  const output = composeMultiMetricMarkdown(multiResult, 'مقایسه')

  assert.ok(output.includes('پاسخ قابل ارائه نیست'), 'should contain rejection message')
  assert.ok(!output.includes('100'), 'must NOT contain number from failed metric')
  assert.ok(!output.includes('200'), 'must NOT contain any numbers')
})

test('S23.7 — composeMultiStepMarkdown: any failed verdict produces no numbers', () => {
  const stepResult: MultiStepResult = {
    results: [makeResult(500), makeResult(300)],
    verdicts: [makeOkVerdict(), makeFailedVerdict('execution-error')],
    plan: { combineStrategy: 'compare', steps: [makePlan('net_sales'), makePlan('purchases')] }
  } as unknown as MultiStepResult

  const output = composeMultiStepMarkdown(stepResult, 'مقایسه')

  assert.ok(output.includes('پاسخ قابل ارائه نیست'), 'should contain rejection message')
  assert.ok(!output.includes('500'), 'must NOT contain numbers')
  assert.ok(!output.includes('300'), 'must NOT contain numbers')
})
