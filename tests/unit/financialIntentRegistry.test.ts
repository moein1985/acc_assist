import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectFinancialIntent, listFinancialIntentDefinitions } from '../../src/main/services/financialIntentRegistry'

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

test('detectFinancialIntent normalizes Persian digits', () => {
  const result = detectFinancialIntent('لیست سال های مالی ۱۴۰۳ را نمایش بده')

  assert.ok(result)
  assert.equal(result?.intentId, 'list_fiscal_years')
})

test('detectFinancialIntent returns null for unrelated prompt', () => {
  const result = detectFinancialIntent('what is the weather today?')

  assert.equal(result, null)
})

test('listFinancialIntentDefinitions exposes roadmap intents including deterministic fiscal intents', () => {
  const definitions = listFinancialIntentDefinitions()

  assert.ok(definitions.length >= 10)
  assert.ok(definitions.some((item) => item.id === 'count_fiscal_years' && item.responseMode === 'deterministic'))
  assert.ok(definitions.some((item) => item.id === 'list_fiscal_years' && item.responseMode === 'deterministic'))
  assert.ok(definitions.some((item) => item.id === 'get_account_balance'))
  assert.ok(definitions.some((item) => item.id === 'get_cashflow_summary'))
})