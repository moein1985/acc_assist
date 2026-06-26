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
    id: 'get_account_balance',
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

void test('detectFinancialIntent (weighted default) routes a clear prompt with bounded confidence', () => {
  const match = detectFinancialIntent('مانده حساب صندوق')

  assert.equal(match?.intentId, 'get_account_balance')
  assert.ok(match !== null)
  assert.ok(match.confidence > 0 && match.confidence < 1)
  // raw == minScore (1) → confidence == 1 - e^-1
  assert.ok(Math.abs(match.confidence - (1 - Math.exp(-1))) < 1e-9)
})

void test('detectFinancialIntent routes debtor-qualified account balance phrasing with ezafe', () => {
  // Natural phrasing «ماندهٔ بدهکار حساب صندوق سال ۱۴۰۲» previously failed to match
  // get_account_balance because (a) the ezafe hamza in «ماندهٔ» and (b) the word
  // «بدهکار» between «مانده» and «حساب» both broke the /مانده\s*حساب/ adjacency,
  // dropping the request to the flaky model-assisted path.
  const match = detectFinancialIntent('ماندهٔ بدهکار حساب صندوق سال ۱۴۰۲')
  assert.equal(match?.intentId, 'get_account_balance')
})

void test('detectFinancialIntent applies exclude guards end-to-end (sales returns)', () => {
  const match = detectFinancialIntent('برگشت از فروش سالانه ۱۴۰۲')
  assert.notEqual(match?.intentId, 'get_sales_summary_by_period')
})

void test('detectFinancialIntent returns the top-ranked weighted candidate', () => {
  // The legacy ratio engine and its ACC_INTENT_SCORING A/B flag were retired; the weighted
  // engine is now the single source of truth, and detectFinancialIntent is the head of the
  // ranked candidate list.
  const candidates = scoreFinancialIntentCandidates('مانده حساب صندوق')
  const best = detectFinancialIntent('مانده حساب صندوق')

  assert.ok(candidates.length >= 1)
  assert.equal(best?.intentId, 'get_account_balance')
  assert.equal(best?.intentId, candidates[0]?.intentId)
  assert.equal(best?.confidence, candidates[0]?.confidence)
})

void test('detectFinancialIntent confidence rises with more anchor matches', () => {
  // receivables prompt matches two patterns (بدهکاران + بدهکاران ماهانه) → higher confidence
  const twoHit = detectFinancialIntent('بدهکاران ماهانه')
  const oneHit = detectFinancialIntent('مانده حساب صندوق')

  assert.equal(twoHit?.intentId, 'get_receivables_summary')
  assert.ok(twoHit !== null && oneHit !== null)
  assert.ok(twoHit.confidence > oneHit.confidence)
})

void test('detectFinancialIntent returns null for unrelated prompts under the weighted engine', () => {
  assert.equal(detectFinancialIntent('سلام حال شما چطور است'), null)
})
