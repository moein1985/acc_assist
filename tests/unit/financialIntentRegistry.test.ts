import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  detectFinancialIntent,
  detectSalesKpiContractCandidates,
  extractFinancialIntentSlots,
  listFinancialIntentDefinitions,
  listSalesKpiContracts
} from '../../src/main/services/financialIntentRegistry'

// LEGACY_REMOVED: all legacy intent detection tests updated (Phase 9).
// detectFinancialIntent always returns null now — FRE engine handles routing.
test('detectFinancialIntent returns null for fiscal-year count prompt (legacy removed)', () => {
  const result = detectFinancialIntent('در دیتابیس چند سال مالی قرار داره؟')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for English fiscal-year list prompt (legacy removed)', () => {
  const result = detectFinancialIntent('List fiscal years in this database')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for show-style fiscal-year list prompt (legacy removed)', () => {
  const result = detectFinancialIntent('Show the fiscal years available in this database')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null after Persian digit normalization (legacy removed)', () => {
  const result = detectFinancialIntent('لیست سال های مالی ۱۴۰۳ را نمایش بده')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian fiscal-year range listing prompt (legacy removed)', () => {
  const result = detectFinancialIntent('فهرست سال‌های مالی از ۱۴۰۱ تا ۱۴۰۴ را نمایش بده')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian account-balance prompt (legacy removed)', () => {
  const result = detectFinancialIntent('مانده حساب فروشگاه را بگو')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian turnover prompt (legacy removed)', () => {
  const result = detectFinancialIntent('گردش حساب در بازه ۱۴۰۳ تا ۱۴۰۴ را نشان بده')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian cashflow prompt (legacy removed)', () => {
  const result = detectFinancialIntent('جریان نقد ماهانه را خلاصه کن')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian account-balance synonym prompt (legacy removed)', () => {
  const result = detectFinancialIntent('مانده سرفصل فروش را بگو')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian cashflow summary prompt (legacy removed)', () => {
  const result = detectFinancialIntent('خلاصه جریان نقد ماهانه را بده')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian receivables synonym prompt (legacy removed)', () => {
  const result = detectFinancialIntent('جمع بدهکاران و دریافتی‌ها را نشان بده')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for English payables synonym prompt (legacy removed)', () => {
  const result = detectFinancialIntent('Show total payables and creditors for this month')
  assert.equal(result, null)
})

test('detectFinancialIntent returns null for Persian cashflow synonym prompt (legacy removed)', () => {
  const result = detectFinancialIntent('خلاصه جریان وجه نقد را بده')
  assert.equal(result, null)
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

test('listFinancialIntentDefinitions returns empty array (legacy removed)', () => {
  const definitions = listFinancialIntentDefinitions()
  assert.equal(definitions.length, 0)
})

test('Golden fast-path intents removed (legacy removed)', () => {
  const definitions = listFinancialIntentDefinitions()
  const goldenSeven = definitions.filter((item) => item.isGoldenFastPath)
  assert.equal(goldenSeven.length, 0)
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

test('detectFinancialIntent returns null for Persian purchase summary prompt (legacy removed)', () => {
  const result = detectFinancialIntent('خرید کل سال ۱۴۰۲ را بگو')
  assert.equal(result, null)
})

test('get_purchase_summary intent removed (legacy removed)', () => {
  const definitions = listFinancialIntentDefinitions()
  const purchaseIntent = definitions.find((item) => item.id === 'get_purchase_summary')
  assert.equal(purchaseIntent, undefined)
})

test('get_account_balance intent removed (legacy removed)', () => {
  const definitions = listFinancialIntentDefinitions()
  const accountBalanceIntent = definitions.find((item) => item.id === 'get_account_balance')
  assert.equal(accountBalanceIntent, undefined)
})

test('intent definitions empty — targetTables guard validation removed (legacy removed)', () => {
  const definitions = listFinancialIntentDefinitions()
  assert.equal(definitions.length, 0)
})