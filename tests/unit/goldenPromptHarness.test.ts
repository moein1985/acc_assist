import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_GOLDEN_CASES, evaluateGoldenPromptSet, formatSummary } from '../../scripts/ops/goldenPromptHarness'

// LEGACY_REMOVED: all golden prompt harness tests updated (Phase 9).
// detectFinancialIntent always returns null — FRE engine handles routing.

test('golden prompt harness returns null intent for fiscal-year count prompt (legacy removed)', () => {
  const result = evaluateGoldenPromptSet([
    {
      id: 'fiscal-year-count',
      prompt: 'در دیتابیس چند سال مالی قرار داره؟',
      expectedIntentId: 'count_fiscal_years',
      expectedMode: 'deterministic'
    }
  ])

  assert.equal(result.total, 1)
  assert.equal(result.passed, 0)
  assert.equal(result.failures.length, 1)
  assert.equal(result.results[0]?.intentId, null)
  assert.equal(result.results[0]?.responseMode, 'unknown')
})

test('golden prompt harness flags mismatched intent for a wrong prompt', () => {
  const result = evaluateGoldenPromptSet([
    {
      id: 'wrong-intent',
      prompt: 'در دیتابیس چند سال مالی قرار داره؟',
      expectedIntentId: 'list_fiscal_years',
      expectedMode: 'deterministic'
    }
  ])

  assert.equal(result.total, 1)
  assert.equal(result.passed, 0)
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0] ?? '', /expected intent/i)
})

test('golden prompt harness reports zero score for deterministic fiscal-year prompts (legacy removed)', () => {
  const result = evaluateGoldenPromptSet([
    {
      id: 'fiscal-year-count',
      prompt: 'در دیتابیس چند سال مالی قرار داره؟',
      expectedIntentId: 'count_fiscal_years',
      expectedMode: 'deterministic',
      expectedTools: ['count_fiscal_years'],
      expectedEvidenceKeywords: ['سال', 'مالی']
    }
  ])

  assert.equal(result.total, 1)
  assert.equal(result.passed, 0)
  assert.equal(result.score, 25)
  assert.equal(result.maxScore, 100)
  assert.equal(result.results[0]?.checks.intent, false)
  assert.equal(result.results[0]?.checks.mode, false)
  assert.equal(result.results[0]?.checks.tool, false)
  assert.equal(result.results[0]?.checks.evidence, true)
})

test('default golden set still contains a stable manager-facing suite', () => {
  assert.ok(DEFAULT_GOLDEN_CASES.length >= 12)
})

test('golden harness reports zero paraphrase coverage (legacy removed)', () => {
  const result = evaluateGoldenPromptSet([
    {
      id: 'sales-paraphrase',
      prompt: 'فروش سالانه را خلاصه کن',
      paraphrases: ['جمع‌بندی فروش سالانه', 'خلاصه فروش سالانه'],
      expectedIntentId: 'get_sales_summary_by_period',
      expectedMode: 'model-assisted'
    }
  ])

  assert.equal(result.total, 1)
  assert.equal(result.results[0]?.paraphraseCoverage, 0)
})

test('formatSummary exposes the score for CI reporting', () => {
  const result = evaluateGoldenPromptSet([
    {
      id: 'fiscal-year-count',
      prompt: 'در دیتابیس چند سال مالی قرار داره؟',
      expectedIntentId: 'count_fiscal_years',
      expectedMode: 'deterministic',
      expectedTools: ['count_fiscal_years'],
      expectedEvidenceKeywords: ['سال', 'مالی']
    }
  ])

  const summary = formatSummary(result)

  assert.match(summary, /Score: 25\/100/)
})