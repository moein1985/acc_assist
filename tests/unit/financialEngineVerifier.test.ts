import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  checkReconciliations,
  checkIntentAlignment,
  mapEngineResultToEvidence,
  evaluateEngineEvidence,
  verifyResult
} from '../../src/main/services/financialEngine/verifier'
import { FinancialEngine } from '../../src/main/services/financialEngine/index'
import type {
  EngineResult,
  MetricPlan,
  MetricDefinition
} from '../../src/main/services/financialEngine/types'
import type { SqlQueryRow } from '../../src/shared/contracts'

function makePlan(metricId: string): MetricPlan {
  return {
    metricId: metricId as MetricPlan['metricId'],
    grain: 'total',
    filters: [],
    confidence: 1.0
  }
}

function makeResult(value: number | null, metricId = 'net_sales'): EngineResult {
  return {
    rows: value === null ? [] : [{ result_value: value }],
    plan: makePlan(metricId),
    compiled: { sql: 'SELECT 1', bindingsDescription: 'test' }
  }
}

test('checkReconciliations — empty rules returns empty', () => {
  const def: MetricDefinition = {
    id: 'net_sales',
    titleFa: 'فروش',
    anchors: [],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'SLS.Invoice', alias: 'src' },
    measure: { kind: 'sum', column: 'x' },
    dimensions: [],
    mandatoryFilters: []
  }
  const result = checkReconciliations(makeResult(100), def)
  assert.equal(result.length, 0)
})

test('checkReconciliations — non_negative passes for positive value', () => {
  const def: MetricDefinition = {
    id: 'purchases',
    titleFa: 'خرید',
    anchors: [],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'POM.PurchaseInvoice', alias: 'src' },
    measure: { kind: 'sum', column: 'x' },
    dimensions: [],
    mandatoryFilters: [],
    reconciliations: [{ id: 'non_neg', description: 'must be non-negative', kind: 'non_negative' }]
  }
  const result = checkReconciliations(makeResult(100), def)
  assert.equal(result.length, 1)
  assert.equal(result[0]!.passed, true)
})

test('checkReconciliations — non_negative fails for negative value', () => {
  const def: MetricDefinition = {
    id: 'purchases',
    titleFa: 'خرید',
    anchors: [],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'POM.PurchaseInvoice', alias: 'src' },
    measure: { kind: 'sum', column: 'x' },
    dimensions: [],
    mandatoryFilters: [],
    reconciliations: [{ id: 'non_neg', description: 'must be non-negative', kind: 'non_negative' }]
  }
  const result = checkReconciliations(makeResult(-50), def)
  assert.equal(result[0]!.passed, false)
  assert.ok(result[0]!.reason?.includes('negative'))
})

test('checkReconciliations — balanced_to_zero passes within tolerance', () => {
  const def: MetricDefinition = {
    id: 'trial_balance',
    titleFa: 'تراز',
    anchors: [],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'x', alias: 'x' },
    measure: { kind: 'sum', column: 'x' },
    dimensions: [],
    mandatoryFilters: [],
    reconciliations: [
      {
        id: 'balanced',
        description: 'must balance to zero',
        kind: 'balanced_to_zero',
        toleranceAbs: 5
      }
    ]
  }
  const result = checkReconciliations(makeResult(3), def)
  assert.equal(result[0]!.passed, true)
})

test('checkReconciliations — balanced_to_zero fails outside tolerance', () => {
  const def: MetricDefinition = {
    id: 'trial_balance',
    titleFa: 'تراز',
    anchors: [],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'x', alias: 'x' },
    measure: { kind: 'sum', column: 'x' },
    dimensions: [],
    mandatoryFilters: [],
    reconciliations: [
      {
        id: 'balanced',
        description: 'must balance to zero',
        kind: 'balanced_to_zero',
        toleranceAbs: 5
      }
    ]
  }
  const result = checkReconciliations(makeResult(100), def)
  assert.equal(result[0]!.passed, false)
  assert.ok(result[0]!.reason?.includes('exceeds tolerance'))
})

test('checkIntentAlignment — matching metric passes', () => {
  const plan = makePlan('net_sales')
  const result = checkIntentAlignment('فروش خالص سال ۱۴۰۲', plan)
  assert.equal(result.passed, true)
})

test('checkIntentAlignment — mismatching metric fails', () => {
  const plan = makePlan('net_sales')
  const result = checkIntentAlignment('خرید سال ۱۴۰۲ چقدر است؟', plan)
  assert.equal(result.passed, false)
  assert.ok(result.reason?.includes('intent mismatch'))
})

test('S23.2 — تراز آزمایشی with account_balance plan fails', () => {
  const plan = makePlan('account_balance')
  const result = checkIntentAlignment('تراز آزمایشی سال ۱۴۰۲', plan)
  assert.equal(result.passed, false)
  assert.ok(result.reason?.includes('intent mismatch'))
})

test('S23.2 — گردش حساب آقای X with trial_balance plan fails', () => {
  const plan = makePlan('trial_balance')
  const result = checkIntentAlignment('گردش حساب آقای احمدی در سال ۱۴۰۲', plan)
  assert.equal(result.passed, false)
  assert.ok(result.reason?.includes('intent mismatch'))
})

test('S23.2 — فروش with purchases plan fails', () => {
  const plan = makePlan('purchases')
  const result = checkIntentAlignment('فروش سال ۱۴۰۲ چقدر بود؟', plan)
  assert.equal(result.passed, false)
  assert.ok(result.reason?.includes('intent mismatch'))
})

test('S23.2 — matching metric passes (regression)', () => {
  const plan = makePlan('net_sales')
  const result = checkIntentAlignment('فروش خالص سال ۱۴۰۲', plan)
  assert.equal(result.passed, true)
})

test('S23.2 — purchases prompt with purchases plan passes (regression)', () => {
  const plan = makePlan('purchases')
  const result = checkIntentAlignment('خرید سال ۱۴۰۲ چقدر است؟', plan)
  assert.equal(result.passed, true)
})

test('mapEngineResultToEvidence — positive data', () => {
  const evidence = mapEngineResultToEvidence(makeResult(64252437897))
  assert.equal(evidence.status, 'ok')
  assert.equal(evidence.rowsReturned, 1)
  assert.equal(evidence.nonNullValue, true)
  assert.equal(evidence.scopeApplied, true)
})

test('mapEngineResultToEvidence — empty result', () => {
  const evidence = mapEngineResultToEvidence(makeResult(null))
  assert.equal(evidence.rowsReturned, 0)
  assert.equal(evidence.nonNullValue, false)
})

test('evaluateEngineEvidence — positive data returns POSITIVE_DATA', () => {
  const verdict = evaluateEngineEvidence(makeResult(64252437897))
  assert.equal(verdict.kind, 'POSITIVE_DATA')
})

test('evaluateEngineEvidence — empty result returns VALID_EMPTY', () => {
  const verdict = evaluateEngineEvidence(makeResult(null))
  assert.equal(verdict.kind, 'VALID_EMPTY')
})

test('verifyResult — ok with no reconciliation rules', () => {
  const def: MetricDefinition = {
    id: 'net_sales',
    titleFa: 'فروش',
    anchors: [],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'SLS.Invoice', alias: 'src' },
    measure: { kind: 'sum', column: 'x' },
    dimensions: [],
    mandatoryFilters: []
  }
  const verdict = verifyResult(makeResult(64252437897), makePlan('net_sales'), def)
  assert.equal(verdict.ok, true)
})

test('verifyResult — fails on reconciliation', () => {
  const def: MetricDefinition = {
    id: 'purchases',
    titleFa: 'خرید',
    anchors: [],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'x', alias: 'x' },
    measure: { kind: 'sum', column: 'x' },
    dimensions: [],
    mandatoryFilters: [],
    reconciliations: [{ id: 'non_neg', description: 'non-negative', kind: 'non_negative' }]
  }
  const verdict = verifyResult(makeResult(-100), makePlan('purchases'), def)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.reason?.includes('reconciliation-failed'))
})

test('S23.4 — fail-closed: execution error returns result: null from runPlan', async () => {
  const mockExecutor = async (_q: string, _s?: AbortSignal): Promise<SqlQueryRow[]> => {
    throw new Error('SQL execution failed')
  }
  const engine = new FinancialEngine({
    quoteSqlTableRef: (r: string) => `[${r.replace('.', '].[')}]`,
    quoteSqlIdentifier: (id: string) => `[${id}]`,
    normalizePersianText: (t: string) => t,
    executeReadOnlySql: mockExecutor
  })

  const plan: MetricPlan = {
    metricId: 'net_sales' as MetricPlan['metricId'],
    grain: 'total',
    filters: [],
    confidence: 1.0
  }

  const runResult = await engine.runPlan(plan)
  assert.equal(runResult.verdict.ok, false, 'verdict should fail on execution error')
  assert.equal(runResult.result, null, 'fail-closed: rejected result must be null, no number should reach caller')
})
