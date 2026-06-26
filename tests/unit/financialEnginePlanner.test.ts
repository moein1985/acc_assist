import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildPlannerPrompt,
  parsePlannerOutput,
  buildModelPlan,
  PLANNER_CONFIDENCE_THRESHOLD,
  type PlannerModelDeps
} from '../../src/main/services/financialEngine/planner'

test('buildPlannerPrompt includes metric catalog and schema', () => {
  const prompt = buildPlannerPrompt('فروش خالص سال ۱۴۰۲')
  assert.ok(prompt.includes('net_sales'))
  assert.ok(prompt.includes('account_balance'))
  assert.ok(prompt.includes('MetricPlan'))
  assert.ok(prompt.includes('فروش خالص سال ۱۴۰۲'))
})

test('parsePlannerOutput — valid JSON net_sales', () => {
  const raw = JSON.stringify({
    metricId: 'net_sales',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    confidence: 0.95
  })
  const result = parsePlannerOutput(raw)
  assert.ok(result.plan)
  assert.equal(result.plan!.metricId, 'net_sales')
  assert.equal(result.plan!.grain, 'total')
  assert.equal(result.plan!.confidence, 0.95)
  assert.equal(result.plan!.filters.length, 1)
})

test('parsePlannerOutput — valid JSON with comparison', () => {
  const raw = JSON.stringify({
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    comparison: { dimension: 'by_year', baseValue: '1402', targetValue: '1403' },
    confidence: 0.9
  })
  const result = parsePlannerOutput(raw)
  assert.ok(result.plan)
  assert.ok(result.plan!.comparison)
  assert.equal(result.plan!.comparison!.baseValue, '1402')
  assert.equal(result.plan!.comparison!.targetValue, '1403')
})

test('parsePlannerOutput — valid JSON with entityName', () => {
  const raw = JSON.stringify({
    metricId: 'account_balance',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    entityName: 'دریافتنی',
    confidence: 0.85
  })
  const result = parsePlannerOutput(raw)
  assert.ok(result.plan)
  assert.equal(result.plan!.entityName, 'دریافتنی')
})

test('parsePlannerOutput — JSON in code fence', () => {
  const raw = '```json\n{"metricId":"net_sales","grain":"total","filters":[],"confidence":0.8}\n```'
  const result = parsePlannerOutput(raw)
  assert.ok(result.plan)
  assert.equal(result.plan!.metricId, 'net_sales')
})

test('parsePlannerOutput — JSON with surrounding text', () => {
  const raw =
    'Here is the plan:\n{"metricId":"purchases","grain":"total","filters":[],"confidence":0.7}\nDone.'
  const result = parsePlannerOutput(raw)
  assert.ok(result.plan)
  assert.equal(result.plan!.metricId, 'purchases')
})

test('parsePlannerOutput — invalid JSON returns error', () => {
  const result = parsePlannerOutput('not json at all')
  assert.equal(result.plan, null)
  assert.ok(result.error)
  assert.equal(result.error, 'no-valid-json')
})

test('parsePlannerOutput — schema validation fails for bad metricId', () => {
  const raw = JSON.stringify({
    metricId: 'unknown_metric',
    grain: 'total',
    filters: [],
    confidence: 0.5
  })
  const result = parsePlannerOutput(raw)
  assert.equal(result.plan, null)
  assert.ok(result.error?.includes('schema-validation'))
})

test('parsePlannerOutput — unsupported grain for metric', () => {
  const raw = JSON.stringify({
    metricId: 'net_sales',
    grain: 'by_account',
    filters: [],
    confidence: 0.8
  })
  const result = parsePlannerOutput(raw)
  assert.equal(result.plan, null)
  assert.ok(result.error?.includes('grain'))
})

test('parsePlannerOutput — invalid year value (3-digit)', () => {
  const raw = JSON.stringify({
    metricId: 'net_sales',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['140'] }],
    confidence: 0.8
  })
  const result = parsePlannerOutput(raw)
  assert.equal(result.plan, null)
  assert.ok(result.error?.includes('invalid-year'))
})

test('parsePlannerOutput — invalid comparison year values', () => {
  const raw = JSON.stringify({
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    comparison: { dimension: 'by_year', baseValue: '14', targetValue: '1403' },
    confidence: 0.8
  })
  const result = parsePlannerOutput(raw)
  assert.equal(result.plan, null)
  assert.ok(result.error?.includes('invalid-comparison'))
})

test('buildModelPlan — stub model returns valid plan', async () => {
  const stub: PlannerModelDeps = {
    callModel: async () =>
      JSON.stringify({
        metricId: 'net_sales',
        grain: 'total',
        filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
        confidence: 0.9
      })
  }
  const result = await buildModelPlan('فروش خالص ۱۴۰۲', stub)
  assert.ok(result.plan)
  assert.equal(result.plan!.metricId, 'net_sales')
})

test('buildModelPlan — stub model returns garbage', async () => {
  const stub: PlannerModelDeps = {
    callModel: async () => 'I cannot help with that.'
  }
  const result = await buildModelPlan('random question', stub)
  assert.equal(result.plan, null)
  assert.ok(result.error)
})

test('buildModelPlan — model call throws', async () => {
  const stub: PlannerModelDeps = {
    callModel: async () => {
      throw new Error('network error')
    }
  }
  const result = await buildModelPlan('test', stub)
  assert.equal(result.plan, null)
  assert.equal(result.error, 'model-call-failed')
})

test('buildModelPlan — low confidence plan', async () => {
  const stub: PlannerModelDeps = {
    callModel: async () =>
      JSON.stringify({
        metricId: 'net_sales',
        grain: 'total',
        filters: [],
        confidence: 0.1
      })
  }
  const result = await buildModelPlan('تعداد کارمندان', stub)
  assert.ok(result.plan)
  assert.ok(result.plan!.confidence < PLANNER_CONFIDENCE_THRESHOLD)
})

test('PLANNER_CONFIDENCE_THRESHOLD is 0.5', () => {
  assert.equal(PLANNER_CONFIDENCE_THRESHOLD, 0.5)
})
