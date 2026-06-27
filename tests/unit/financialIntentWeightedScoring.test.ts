import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectFinancialIntent,
  scoreFinancialIntentCandidates,
  scoreIntent,
  type FinancialIntentDefinition
} from '../../src/main/services/financialIntentRegistry'
import { normalizePersianText } from '../../src/main/services/textNormalization'

function makeDef(overrides: Partial<FinancialIntentDefinition>): FinancialIntentDefinition {
  return {
    id: 'get_account_balance' as never,
    description: 'synthetic test definition',
    responseMode: 'deterministic',
    requiredSlots: [],
    patterns: [],
    ...overrides
  }
}

void test('scoreIntent sums anchor weights additively (no ratio division)', () => {
  const def = makeDef({
    anchors: [
      { pattern: /alpha/iu, weight: 3 },
      { pattern: /beta/iu, weight: 2 }
    ],
    minScore: 3
  })

  assert.equal(scoreIntent('alpha only', def), 3)
  assert.equal(scoreIntent('alpha and beta together', def), 5)
  assert.equal(scoreIntent('gamma only', def), 0)
})

void test('scoreIntent adds support weights on top of anchors', () => {
  const def = makeDef({
    anchors: [{ pattern: /sales/iu, weight: 3 }],
    support: [{ pattern: /annual/iu, weight: 1 }],
    minScore: 3
  })

  assert.equal(scoreIntent('annual sales', def), 4)
  // support alone (no anchor hit) cannot stand in for an anchor → score is zero
  assert.equal(scoreIntent('annual report', def), 0)
})

void test('anchor hits clear the minimum threshold', () => {
  const def = makeDef({
    anchors: [{ pattern: /فروش/u, weight: 3 }],
    minScore: 3
  })

  const score = scoreIntent('فروش سالانه', def)
  assert.ok(score >= (def.minScore ?? 1), `expected ${score} >= ${def.minScore}`)
})

void test('exclusions cleanly drop the score to zero even when anchors match', () => {
  const def = makeDef({
    anchors: [{ pattern: /فروش/u, weight: 3 }],
    exclude: [/برگشت\s*از\s*فروش/u],
    minScore: 3
  })

  // anchor present and threshold cleared without the excluded phrase
  assert.ok(scoreIntent('فروش سالانه', def) >= (def.minScore ?? 1))
  // excluded phrase forces a hard zero regardless of anchor matches
  assert.equal(scoreIntent('برگشت از فروش سالانه', def), 0)
})

void test('weighted scoring is not penalized by anchor count (ratio-bug regression)', () => {
  const richDef = makeDef({
    anchors: Array.from({ length: 7 }, (_, index) => ({
      pattern: new RegExp(`kw${index}`, 'iu'),
      weight: 1
    })),
    minScore: 1
  })
  const sparseDef = makeDef({
    anchors: [{ pattern: /kw0/iu, weight: 1 }],
    minScore: 1
  })

  // One match scores the same absolute value regardless of how many anchors exist
  assert.equal(scoreIntent('kw0 present', richDef), 1)
  assert.equal(scoreIntent('kw0 present', sparseDef), 1)
  // More matches in the rich intent outscore the sparse intent (ratio engine would invert this)
  assert.ok(scoreIntent('kw0 kw1', richDef) > scoreIntent('kw0 kw1', sparseDef))
})

void test('scoreIntent falls back to legacy patterns as weight-1 anchors', () => {
  const def = makeDef({
    patterns: [/مانده\s*حساب/u, /account\s+balance/iu],
    minScore: 1
  })

  assert.equal(scoreIntent(normalizePersianText('مانده حساب صندوق'), def), 1)
  assert.equal(scoreIntent('account balance report', def), 1)
  assert.equal(scoreIntent('unrelated text', def), 0)
})

void test('detectFinancialIntent returns null for account balance prompt (legacy removed)', () => {
  const match = detectFinancialIntent('مانده حساب صندوق')
  assert.equal(match, null)
})

void test('detectFinancialIntent returns null for debtor-qualified account balance phrasing (legacy removed)', () => {
  const match = detectFinancialIntent('ماندهٔ بدهکار حساب صندوق سال ۱۴۰۲')
  assert.equal(match, null)
})

void test('detectFinancialIntent returns null for sales returns prompt (legacy removed)', () => {
  const match = detectFinancialIntent('برگشت از فروش سالانه ۱۴۰۲')
  assert.equal(match, null)
})

void test('detectFinancialIntent returns null — no candidates (legacy removed)', () => {
  const candidates = scoreFinancialIntentCandidates('مانده حساب صندوق')
  const best = detectFinancialIntent('مانده حساب صندوق')

  assert.equal(candidates.length, 0)
  assert.equal(best, null)
})

void test('detectFinancialIntent returns null for receivables and balance prompts (legacy removed)', () => {
  const twoHit = detectFinancialIntent('بدهکاران ماهانه')
  const oneHit = detectFinancialIntent('مانده حساب صندوق')

  assert.equal(twoHit, null)
  assert.equal(oneHit, null)
})

void test('detectFinancialIntent returns null for unrelated prompts under the weighted engine', () => {
  assert.equal(detectFinancialIntent('سلام حال شما چطور است'), null)
})
