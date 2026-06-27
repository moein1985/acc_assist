import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectFinancialIntent,
  scoreFinancialIntentCandidates
} from '../../src/main/services/financialIntentRegistry'

// LEGACY_REMOVED: all golden routing cases now expect null (Phase 9).
// detectFinancialIntent always returns null — FRE engine handles routing.
const GOLDEN_CASES: Array<{ prompt: string; expected: null }> = [
  { prompt: 'خلاصه فروش ماهانه امسال', expected: null },
  { prompt: 'گزارش فروش فصلی', expected: null },
  { prompt: 'گزارش خرید این فصل', expected: null },
  { prompt: 'رسید انبار این ماه را گزارش بده', expected: null },
  { prompt: 'برگشت از فروش سال ۱۴۰۲', expected: null },
  { prompt: 'برگشت از خرید این ماه', expected: null },
  { prompt: 'چند سال مالی داریم؟', expected: null },
  { prompt: 'لیست سال های مالی موجود', expected: null },
  { prompt: 'مانده حساب صندوق', expected: null },
  { prompt: 'مانده سرفصل فروش را بگو', expected: null },
  { prompt: 'مانده حساب فروشگاه را بگو', expected: null }
]

for (const { prompt, expected } of GOLDEN_CASES) {
  void test(`golden routing (legacy removed): ${prompt}`, () => {
    const result = detectFinancialIntent(prompt)
    assert.equal(result?.intentId ?? null, expected)
  })
}

void test('golden routing returns null for all prompts (legacy removed)', () => {
  for (const { prompt } of GOLDEN_CASES) {
    const best = detectFinancialIntent(prompt)
    const candidates = scoreFinancialIntentCandidates(prompt)
    assert.equal(best, null)
    assert.equal(candidates.length, 0)
  }
})

void test('sales and purchase intents no longer detected (legacy removed)', () => {
  const sales = detectFinancialIntent('خلاصه فروش ماهانه امسال')
  const purchase = detectFinancialIntent('گزارش خرید این فصل')

  assert.equal(sales, null)
  assert.equal(purchase, null)
})