import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { routeMetric } from '../../src/main/services/financialEngine/router'
import { evaluateResult } from '../../src/main/services/financialEngine/resultEvaluator'
import { buildPlannerPrompt, type RetryHint } from '../../src/main/services/financialEngine/planner'
import type { MetricPlan } from '../../src/main/services/financialEngine/types'
import type { SqlQueryRow } from '../../src/shared/contracts'

describe('S22.1 — Smart anchor weighting', () => {
  it('long specific anchor gets higher score than short generic anchor', () => {
    const specific = routeMetric('بدهکار و بستانکار حساب‌ها')
    assert.ok(specific.metricId, 'should route to a metric')
    assert.ok(specific.confidence >= 0.7, 'specific anchor should have decent confidence')
  })

  it('generic anchor "فروش" alone gets low confidence (0.5)', () => {
    const result = routeMetric('فروش')
    assert.equal(result.confidence, 0.5, 'generic anchor should get 0.5 confidence')
  })

  it('specific anchor "فروش ماهانه" routes to sales_by_period not net_sales', () => {
    const result = routeMetric('فروش ماهانه سال ۱۴۰۲')
    assert.equal(result.metricId, 'sales_by_period')
  })
})

describe('S22.2 — Generic anchor penalization', () => {
  it('"تراز" alone does not route to trial_balance with high confidence', () => {
    const result = routeMetric('تراز')
    assert.ok(result.confidence < 1.0, 'generic "تراز" should not get 1.0 confidence')
  })

  it('"ترازنامه" routes to balance_sheet not trial_balance', () => {
    const result = routeMetric('ترازنامه سال ۱۴۰۲')
    assert.equal(result.metricId, 'balance_sheet')
  })

  it('"تراز آزمایشی" routes to trial_balance not balance_sheet', () => {
    const result = routeMetric('تراز آزمایشی سال ۱۴۰۲')
    assert.equal(result.metricId, 'trial_balance')
  })
})

describe('S22.4 — Cross-metric excludeSignals', () => {
  it('گردش حساب does not route to fiscal_year_list', () => {
    const result = routeMetric('گردش حساب ۱۴۰۲ چقدر است؟')
    assert.notEqual(result.metricId, 'fiscal_year_list')
    assert.notEqual(result.metricId, 'fiscal_year_count')
  })

  it('گردش حساب routes to account_turnover', () => {
    const result = routeMetric('گردش حساب ۱۴۰۲')
    assert.equal(result.metricId, 'account_turnover')
  })
})

describe('S22.5 — Router cache version', () => {
  it('caches results and returns same value on second call', () => {
    const r1 = routeMetric('فروش ۱۴۰۲')
    const r2 = routeMetric('فروش ۱۴۰۲')
    assert.deepEqual(r1, r2)
  })
})

describe('S22.6-S22.7 — ResultEvaluator', () => {
  const basePlan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 0.9
  }

  it('accepts non-empty results for correct metric', () => {
    const rows: SqlQueryRow[] = [{ value: 1000 }]
    const result = evaluateResult('فروش ۱۴۰۲', 'net_sales', rows, basePlan)
    assert.equal(result.acceptable, true)
  })

  it('rejects zero rows', () => {
    const rows: SqlQueryRow[] = []
    const result = evaluateResult('فروش ۱۴۰۲', 'net_sales', rows, basePlan)
    assert.equal(result.acceptable, false)
    assert.equal(result.reason, 'zero-rows')
  })

  it('detects metric mismatch: گردش → fiscal_year_list', () => {
    const rows: SqlQueryRow[] = [{ FiscalYearId: 1, Title: '1402' }]
    const result = evaluateResult('گردش حساب ۱۴۰۲', 'fiscal_year_list', rows, basePlan)
    assert.equal(result.acceptable, false)
    assert.ok(result.reason.includes('metric-mismatch'))
    assert.equal(result.suggestedMetricId, 'account_turnover')
  })

  it('detects metric mismatch: ترازنامه → trial_balance', () => {
    const rows: SqlQueryRow[] = [{ value: 1000 }]
    const result = evaluateResult('ترازنامه ۱۴۰۲', 'trial_balance', rows, basePlan)
    assert.equal(result.acceptable, false)
    assert.ok(result.reason.includes('metric-mismatch'))
    assert.equal(result.suggestedMetricId, 'balance_sheet')
  })

  it('detects metric mismatch: تراز آزمایشی → balance_sheet', () => {
    const rows: SqlQueryRow[] = [{ value: 1000 }]
    const result = evaluateResult('تراز آزمایشی ۱۴۰۲', 'balance_sheet', rows, basePlan)
    assert.equal(result.acceptable, false)
    assert.ok(result.reason.includes('metric-mismatch'))
    assert.equal(result.suggestedMetricId, 'trial_balance')
  })
})

describe('S22.8 — RetryHint in planner prompt', () => {
  it('includes retry hint in planner prompt when provided', () => {
    const hint: RetryHint = {
      failedMetricId: 'fiscal_year_list',
      reason: 'metric-mismatch:گردش→fiscal_year_list'
    }
    const prompt = buildPlannerPrompt('گردش حساب ۱۴۰۲', undefined, undefined, hint)
    assert.ok(prompt.includes('fiscal_year_list'), 'prompt should mention failed metric')
    assert.ok(prompt.includes('metric-mismatch'), 'prompt should mention failure reason')
  })

  it('does not include retry hint when not provided', () => {
    const prompt = buildPlannerPrompt('فروش ۱۴۰۲', undefined, undefined, undefined)
    assert.ok(!prompt.includes('توجه: metric'), 'prompt should not contain retry hint')
  })
})
