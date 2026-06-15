import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  detectFinancialIntent,
  detectSalesKpiContractCandidates,
  extractFinancialIntentSlots,
  listFinancialIntentDefinitions,
  listSalesKpiContracts
} from '../../src/main/services/financialIntentRegistry'

test('detectFinancialIntent maps Persian fiscal-year count prompt', () => {
  const result = detectFinancialIntent('در دیتابیس چند سال مالی قرار داره؟')

  assert.ok(result)
  assert.equal(result?.intentId, 'count_fiscal_years')
})

test('detectFinancialIntent maps English fiscal-year list prompt', () => {
  const result = detectFinancialIntent('List fiscal years in this database')

  assert.ok(result)
  assert.equal(result?.intentId, 'list_fiscal_years')
})

test('detectFinancialIntent maps show-style fiscal-year list prompt', () => {
  const result = detectFinancialIntent('Show the fiscal years available in this database')

  assert.ok(result)
  assert.equal(result?.intentId, 'list_fiscal_years')
})

test('detectFinancialIntent normalizes Persian digits', () => {
  const result = detectFinancialIntent('لیست سال های مالی ۱۴۰۳ را نمایش بده')

  assert.ok(result)
  assert.equal(result?.intentId, 'list_fiscal_years')
})

test('detectFinancialIntent maps Persian fiscal-year range listing prompt', () => {
  const result = detectFinancialIntent('فهرست سال‌های مالی از ۱۴۰۱ تا ۱۴۰۴ را نمایش بده')

  assert.ok(result)
  assert.equal(result?.intentId, 'list_fiscal_years')
})

test('detectFinancialIntent maps Persian account-balance prompt', () => {
  const result = detectFinancialIntent('مانده حساب فروشگاه را بگو')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_account_balance')
})

test('detectFinancialIntent maps Persian turnover prompt', () => {
  const result = detectFinancialIntent('گردش حساب در بازه ۱۴۰۳ تا ۱۴۰۴ را نشان بده')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_account_turnover')
})

test('detectFinancialIntent maps Persian cashflow prompt', () => {
  const result = detectFinancialIntent('جریان نقد ماهانه را خلاصه کن')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_cashflow_summary')
})

test('detectFinancialIntent maps Persian account-balance synonym prompt', () => {
  const result = detectFinancialIntent('مانده سرفصل فروش را بگو')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_account_balance')
})

test('detectFinancialIntent maps Persian cashflow summary prompt', () => {
  const result = detectFinancialIntent('خلاصه جریان نقد ماهانه را بده')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_cashflow_summary')
})

test('detectFinancialIntent maps Persian receivables synonym prompt', () => {
  const result = detectFinancialIntent('جمع بدهکاران و دریافتی‌ها را نشان بده')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_receivables_summary')
})

test('detectFinancialIntent maps English payables synonym prompt', () => {
  const result = detectFinancialIntent('Show total payables and creditors for this month')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_payables_summary')
})

test('detectFinancialIntent maps Persian cashflow synonym prompt', () => {
  const result = detectFinancialIntent('خلاصه جریان وجه نقد را بده')

  assert.ok(result)
  assert.equal(result?.intentId, 'get_cashflow_summary')
})

test('extractFinancialIntentSlots detects account and date-range hints', () => {
  const slots = extractFinancialIntentSlots('مانده حساب فروشگاه در بازه ۱۴۰۳ تا ۱۴۰۴ را بگو')

  assert.equal(slots.accountCodeOrName, 'detected')
  assert.equal(slots.dateRange, 'detected')
})

test('extractFinancialIntentSlots detects fiscal-year and period hints', () => {
  const slots = extractFinancialIntentSlots('جریان نقد ماهانه برای سال مالی ۱۴۰۳')

  assert.equal(slots.fiscalYear, 'detected')
  assert.equal(slots.period, 'detected')
})

test('detectFinancialIntent returns null for unrelated prompt', () => {
  const result = detectFinancialIntent('what is the weather today?')

  assert.equal(result, null)
})

test('listFinancialIntentDefinitions exposes roadmap intents including deterministic balance intents', () => {
  const definitions = listFinancialIntentDefinitions()

  assert.ok(definitions.length >= 10)
  assert.ok(definitions.some((item) => item.id === 'count_fiscal_years' && item.responseMode === 'deterministic'))
  assert.ok(definitions.some((item) => item.id === 'list_fiscal_years' && item.responseMode === 'deterministic'))
  assert.ok(definitions.some((item) => item.id === 'get_account_balance' && item.responseMode === 'deterministic'))
  assert.ok(definitions.some((item) => item.id === 'get_cashflow_summary' && item.responseMode === 'deterministic'))
  assert.ok(definitions.some((item) => item.id === 'get_receivables_summary' && item.responseMode === 'deterministic'))
  assert.ok(definitions.some((item) => item.id === 'get_payables_summary' && item.responseMode === 'deterministic'))
})

test('Golden 5 intents carry fast-path metadata and target scope', () => {
  const definitions = listFinancialIntentDefinitions()
  const goldenFive = definitions.filter((item) => item.isGoldenFastPath)

  assert.equal(goldenFive.length, 5)
  assert.ok(goldenFive.some((item) => item.id === 'count_fiscal_years' && item.targetTables?.length))
  assert.ok(goldenFive.some((item) => item.id === 'list_fiscal_years' && item.requiredScopeFilters?.includes('fiscal_year')))
  assert.ok(goldenFive.some((item) => item.id === 'get_account_balance' && item.requiredScopeFilters?.length))
  assert.ok(goldenFive.some((item) => item.id === 'get_receivables_summary' && item.aggregate))
  assert.ok(goldenFive.some((item) => item.id === 'get_payables_summary' && item.projection?.length))
})

test('listSalesKpiContracts exposes the annual sales KPI dictionary', () => {
  const contracts = listSalesKpiContracts()

  assert.ok(contracts.some((entry) => entry.id === 'gross_sales'))
  assert.ok(contracts.some((entry) => entry.id === 'net_sales'))
  assert.ok(contracts.some((entry) => entry.id === 'booked_sales'))
})

test('detectSalesKpiContractCandidates flags ambiguous annual sales prompts', () => {
  const result = detectSalesKpiContractCandidates('فروش سالانه را برای سال 1403 گزارش کن')

  assert.equal(result.isAmbiguous, true)
  assert.ok(result.contractIds.includes('gross_sales'))
  assert.ok(result.contractIds.includes('net_sales'))
  assert.ok(result.contractIds.includes('booked_sales'))
})

test('detectSalesKpiContractCandidates keeps explicit KPI wording precise', () => {
  const result = detectSalesKpiContractCandidates('فروش ناخالص سالانه 1403 را گزارش کن')

  assert.equal(result.isAmbiguous, false)
  assert.deepEqual(result.contractIds, ['gross_sales'])
})