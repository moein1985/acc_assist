import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FinancialEngine } from '../../src/main/services/financialEngine/index'
import type { EngineRunResult } from '../../src/main/services/financialEngine/index'
import type { SqlQueryRow } from '../../src/shared/contracts'

function asSingleResult(outcome: Awaited<ReturnType<FinancialEngine['run']>>): EngineRunResult {
  if ('results' in outcome) {
    throw new Error('Expected single-metric result but got MultiMetricResult')
  }
  return outcome
}

function makeMockExecutor(
  value: number
): (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]> {
  return async (_query: string, _signal?: AbortSignal): Promise<SqlQueryRow[]> => {
    return [{ result_value: value }]
  }
}

function makeCompilerDeps() {
  return {
    quoteSqlTableRef: (ref: string) => {
      const parts = ref.split('.')
      if (parts.length === 2) return `[${parts[0]}].[${parts[1]}]`
      return `[${ref}]`
    },
    quoteSqlIdentifier: (id: string) => `[${id}]`,
    normalizePersianText: (text: string) => text
  }
}

test('engine end-to-end: net_sales 1402 — route → plan → compile → exec → verify → explain', async () => {
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(64252437897)
  })

  const result = asSingleResult(await engine.run('فروش خالص سال ۱۴۰۲ چقدر است؟'))

  assert.ok(result.result, 'engine should produce a result')
  assert.equal(result.verdict.ok, true, 'verdict should be ok')
  assert.equal(result.result!.plan.metricId, 'net_sales')
  assert.equal(result.result!.plan.grain, 'total')
  assert.equal(result.result!.rows[0]!['result_value'], 64252437897)
})

test('engine end-to-end: purchases 1402', async () => {
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(226110419451)
  })

  const result = asSingleResult(await engine.run('خرید سال ۱۴۰۲ چقدر است؟'))

  assert.ok(result.result)
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'purchases')
  assert.equal(result.result!.rows[0]!['result_value'], 226110419451)
})

test('engine end-to-end: account_balance 1402', async () => {
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(19755458505)
  })

  const result = asSingleResult(await engine.run('مانده حساب دریافتنی در سال ۱۴۰۲'))

  assert.ok(result.result)
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'account_balance')
  assert.equal(result.result!.rows[0]!['result_value'], 19755458505)
})

test('engine end-to-end: trial_balance 1402', async () => {
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(5426804727946)
  })

  const result = asSingleResult(await engine.run('تراز آزمایشی ۱۴۰۲'))

  assert.ok(result.result)
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'trial_balance')
  assert.equal(result.result!.rows[0]!['result_value'], 5426804727946)
})

test('engine end-to-end: cash_bank_balance 1402', async () => {
  const executor = async (query: string): Promise<SqlQueryRow[]> => {
    if (query.includes('BankAccountBalance')) return [{ result_value: 7393606464 }]
    return [{ result_value: 2127900602 }]
  }
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: executor
  })

  const result = asSingleResult(await engine.run('مانده نقد و بانک در سال ۱۴۰۲'))

  assert.ok(result.result)
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'cash_bank_balance')
  assert.equal(result.result!.rows[0]!['result_value'], 9521507066)
})

test('engine safety guard: irrelevant question degrades to no-metric-match', async () => {
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(0)
  })

  const result = asSingleResult(await engine.run('تعداد کارمندان چقدر است؟'))

  assert.equal(result.result, null)
  assert.equal(result.verdict.ok, false)
  assert.ok(
    result.verdict.reason === 'no-metric-match' ||
      result.verdict.reason === 'low-confidence-clarify',
    `reason should be no-metric-match or clarify, got: ${result.verdict.reason}`
  )
})

test('engine: explainer produces markdown with correct number', async () => {
  const { composeEngineResponseMarkdown } =
    await import('../../src/main/services/financialEngine/explainer')
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(64252437897)
  })

  const result = asSingleResult(await engine.run('فروش خالص سال ۱۴۰۲ چقدر است؟'))
  assert.ok(result.result)

  const markdown = composeEngineResponseMarkdown(
    result.result!,
    result.verdict,
    'فروش خالص سال ۱۴۰۲'
  )
  assert.ok(markdown.includes('### Summary'))
  assert.ok(markdown.includes('### Evidence'))
  assert.ok(markdown.includes('64,252,437,897'))
  assert.ok(markdown.includes('مسیر پاسخ: engine'))
})

test('engine multi-metric: فروش و خرید ۱۴۰۲ — two metrics, side_by_side', async () => {
  const executor = async (query: string): Promise<SqlQueryRow[]> => {
    if (query.includes('SaleInvoice') || query.includes('SaleFact')) {
      return [{ result_value: 64252437897 }]
    }
    return [{ result_value: 226110419451 }]
  }
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: executor
  })

  const outcome = await engine.run('فروش و خرید ۱۴۰۲')

  assert.ok('results' in outcome, 'should be a MultiMetricResult')
  if ('results' in outcome && 'joinMode' in outcome.plan) {
    assert.equal(outcome.results.length, 2, 'should have 2 results')
    assert.equal(outcome.plan.joinMode, 'side_by_side')
    assert.ok(outcome.verdicts.every((v) => v.ok), 'all verdicts should be ok')
    const metricIds = outcome.results.map((r) => r.plan.metricId)
    assert.ok(metricIds.includes('net_sales'))
    assert.ok(metricIds.includes('purchases'))
  }
})

test('S14.42: conversational drill-down — فروش ۱۴۰۳ → نمایش بده → به تفکیک ماه', async () => {
  const executor = async (query: string): Promise<SqlQueryRow[]> => {
    if (query.includes('GROUP BY') || query.includes('MONTH(')) {
      return [
        { result_value: 5000000, label: '1' },
        { result_value: 7000000, label: '2' },
        { result_value: 3000000, label: '3' }
      ]
    }
    return [{ result_value: 15000000 }]
  }
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: executor
  })

  // Step 1: Initial query — "فروش ۱۴۰۳"
  const step1 = asSingleResult(await engine.run('فروش ۱۴۰۳ چقدر است؟'))
  assert.ok(step1.result, 'step 1 should produce a result')
  assert.equal(step1.verdict.ok, true)
  assert.equal(step1.result!.plan.metricId, 'net_sales')
  assert.equal(step1.result!.plan.grain, 'total')

  const lastPlan = step1.result!.plan

  // Step 2: Drill-down — "نمایش بده" (should switch to by_voucher if supported, or stay total)
  const step2 = asSingleResult(await engine.run('نمایش بده فاکتورها', undefined, lastPlan))
  assert.ok(step2.result, 'step 2 should produce a result')
  assert.equal(step2.verdict.ok, true)
  assert.equal(step2.result!.plan.metricId, 'net_sales', 'should inherit metricId')
  const yearFilter2 = step2.result!.plan.filters.find((f) => f.dimension === 'by_year')
  assert.ok(yearFilter2, 'should inherit year filter')
  assert.equal(yearFilter2!.values[0], '1403')

  // Step 3: Grain change — "به تفکیک ماه"
  const step3 = asSingleResult(await engine.run('به تفکیک ماه', undefined, step2.result!.plan))
  assert.ok(step3.result, 'step 3 should produce a result')
  assert.equal(step3.verdict.ok, true)
  assert.equal(step3.result!.plan.metricId, 'net_sales', 'should still inherit metricId')
  assert.equal(step3.result!.plan.grain, 'by_month', 'should change grain to by_month')
  const yearFilter3 = step3.result!.plan.filters.find((f) => f.dimension === 'by_year')
  assert.ok(yearFilter3, 'should still inherit year filter')
  assert.equal(yearFilter3!.values[0], '1403')
})

test('S10.13: engine derived metric — نسبت فروش به خرید ۱۴۰۲ — single percent value', async () => {
  const executor = async (query: string): Promise<SqlQueryRow[]> => {
    if (query.includes('SLS.Invoice') || query.includes('SaleInvoice')) {
      return [{ result_value: 64252437897 }]
    }
    return [{ result_value: 226110419451 }]
  }
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: executor
  })

  const outcome = await engine.run('نسبت فروش به خرید ۱۴۰۲')
  const single = asSingleResult(outcome)

  assert.ok(single.verdict.ok, 'derived metric verdict should be ok')
  assert.ok(single.result, 'should have result')
  const value = Number(single.result!.rows[0]?.['result_value'] ?? 0)
  assert.ok(value > 0, 'derived ratio should be positive')
})
