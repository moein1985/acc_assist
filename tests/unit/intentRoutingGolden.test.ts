import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectFinancialIntent,
  scoreFinancialIntentCandidates,
  type FinancialIntentId
} from '../../src/main/services/financialIntentRegistry'

/**
 * Golden routing fixtures (blueprint Section 3.1). These lock in the data-driven routing
 * behavior of the weighted intent engine after the hard-coded fast-paths were retired.
 * `null` means the prompt must NOT route to a financial intent (e.g. exclusion guards firing).
 */
const GOLDEN_CASES: Array<{ prompt: string; expected: FinancialIntentId | null }> = [
  // Sales / purchase (the previously missing scopes)
  { prompt: 'خلاصه فروش ماهانه امسال', expected: 'get_sales_summary_by_period' },
  { prompt: 'گزارش فروش فصلی', expected: 'get_sales_summary_by_period' },
  { prompt: 'گزارش خرید این فصل', expected: 'get_purchase_summary' },
  { prompt: 'رسید انبار این ماه را گزارش بده', expected: 'get_purchase_summary' },

  // Exclusion guards (returns must not route to the summary intents)
  { prompt: 'برگشت از فروش سال ۱۴۰۲', expected: null },
  { prompt: 'برگشت از خرید این ماه', expected: null },

  // Fiscal years (must still route after fast-path removal)
  { prompt: 'چند سال مالی داریم؟', expected: 'count_fiscal_years' },
  { prompt: 'لیست سال های مالی موجود', expected: 'list_fiscal_years' },

  // Account/ledger balance must win over sales even when the word فروش appears
  { prompt: 'مانده حساب صندوق', expected: 'get_account_balance' },
  { prompt: 'مانده سرفصل فروش را بگو', expected: 'get_account_balance' },

  // Compound words must NOT hijack the sales scope
  { prompt: 'مانده حساب فروشگاه را بگو', expected: 'get_account_balance' }
]

for (const { prompt, expected } of GOLDEN_CASES) {
  void test(`golden routing: ${prompt}`, () => {
    const result = detectFinancialIntent(prompt)
    assert.equal(result?.intentId ?? null, expected)
  })
}

void test('golden routing matches the head of the ranked weighted candidate list', () => {
  for (const { prompt } of GOLDEN_CASES) {
    const best = detectFinancialIntent(prompt)
    const candidates = scoreFinancialIntentCandidates(prompt)
    assert.equal(best?.intentId ?? null, candidates[0]?.intentId ?? null)
  }
})

void test('sales and purchase intents expose their declarative target tables', () => {
  // The schema mapping is now data-driven: scope lives on the intent definition, not in code.
  const sales = detectFinancialIntent('خلاصه فروش ماهانه امسال')
  const purchase = detectFinancialIntent('گزارش خرید این فصل')

  assert.equal(sales?.intentId, 'get_sales_summary_by_period')
  assert.equal(purchase?.intentId, 'get_purchase_summary')
})
