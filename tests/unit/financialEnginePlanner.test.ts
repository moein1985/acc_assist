import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildPlannerPrompt,
  parsePlannerOutput,
  buildModelPlan,
  buildDeterministicPlan,
  buildClarify,
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

// ─── S10.11 — Extended planner tests ─────────────────────────────────────────

test('S10.3: parsePlannerOutput — MultiMetricPlan with plans array', () => {
  const raw = JSON.stringify({
    plans: [
      { metricId: 'net_sales', grain: 'total', filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }], confidence: 0.9 },
      { metricId: 'purchases', grain: 'total', filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }], confidence: 0.9 }
    ],
    joinMode: 'side_by_side',
    confidence: 0.9
  })
  const result = parsePlannerOutput(raw)
  assert.ok(result.multiPlan, 'should parse multiPlan')
  assert.equal(result.multiPlan!.plans.length, 2)
  assert.equal(result.multiPlan!.joinMode, 'side_by_side')
  assert.equal(result.multiPlan!.plans[0]!.metricId, 'net_sales')
  assert.equal(result.multiPlan!.plans[1]!.metricId, 'purchases')
})

test('S10.3: parsePlannerOutput — MultiMetricPlan comparison mode', () => {
  const raw = JSON.stringify({
    plans: [
      { metricId: 'net_sales', grain: 'total', filters: [], confidence: 0.9 },
      { metricId: 'purchases', grain: 'total', filters: [], confidence: 0.9 }
    ],
    joinMode: 'comparison',
    confidence: 0.85
  })
  const result = parsePlannerOutput(raw)
  assert.ok(result.multiPlan)
  assert.equal(result.multiPlan!.joinMode, 'comparison')
})

test('S10.4: buildModelPlan — stub model returns MultiMetricPlan', async () => {
  const stub: PlannerModelDeps = {
    callModel: async () =>
      JSON.stringify({
        plans: [
          { metricId: 'net_sales', grain: 'total', filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }], confidence: 0.9 },
          { metricId: 'purchases', grain: 'total', filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }], confidence: 0.9 }
        ],
        joinMode: 'side_by_side',
        confidence: 0.9
      })
  }
  const result = await buildModelPlan('فروش و خرید ۱۴۰۲', stub)
  assert.ok(result.multiPlan)
  assert.equal(result.multiPlan!.plans.length, 2)
})

test('S10.8: buildDeterministicPlan — no year in prompt auto-fills current Persian year', () => {
  const plan = buildDeterministicPlan('فروش', 'net_sales')
  assert.ok(plan)
  const yearFilter = plan!.filters.find((f) => f.dimension === 'by_year')
  assert.ok(yearFilter, 'should have a by_year filter')
  assert.equal(yearFilter!.op, 'eq')
  assert.ok(/^\d{4}$/.test(yearFilter!.values[0]!), 'year should be 4-digit')
})

test('S10.8: buildDeterministicPlan — explicit year takes precedence over auto-fill', () => {
  const plan = buildDeterministicPlan('فروش ۱۴۰۲', 'net_sales')
  assert.ok(plan)
  const yearFilter = plan!.filters.find((f) => f.dimension === 'by_year')
  assert.ok(yearFilter)
  assert.equal(yearFilter!.values[0], '1402')
})

test('S10.6: buildClarify — returns question and suggestions', () => {
  const result = buildClarify('فروش', 'net_sales')
  assert.ok(result.question)
  assert.ok(result.question.includes('فروش'))
  assert.ok(Array.isArray(result.suggestions))
})

test('S10.6: buildClarify — suggestions exclude the queried metric', () => {
  const result = buildClarify('فروش', 'net_sales')
  for (const suggestion of result.suggestions) {
    assert.ok(!suggestion.includes('فروش خالص'), 'should not include the queried metric itself')
  }
})

test('S10.1: buildPlannerPrompt includes 10+ examples', () => {
  const prompt = buildPlannerPrompt('test')
  const exampleCount = (prompt.match(/مثال\s/gu) || []).length
  assert.ok(exampleCount >= 10, `should have 10+ examples, got ${exampleCount}`)
})

test('S10.1: buildPlannerPrompt includes MultiMetricPlan schema', () => {
  const prompt = buildPlannerPrompt('test')
  assert.ok(prompt.includes('MultiMetricPlan'), 'should include MultiMetricPlan schema')
  assert.ok(prompt.includes('joinMode'), 'should include joinMode in schema')
})

test('S10.2: buildPlannerPrompt includes topN in schema', () => {
  const prompt = buildPlannerPrompt('test')
  assert.ok(prompt.includes('topN'), 'should include topN in schema')
})

test('parsePlannerOutput — completely broken JSON does not crash', () => {
  const result = parsePlannerOutput('{ broken json }}}')
  assert.equal(result.plan, null)
  assert.ok(result.error)
})

test('parsePlannerOutput — empty string returns error', () => {
  const result = parsePlannerOutput('')
  assert.equal(result.plan, null)
  assert.equal(result.error, 'no-valid-json')
})
