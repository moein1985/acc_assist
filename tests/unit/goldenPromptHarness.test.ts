import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_GOLDEN_CASES, evaluateGoldenPromptSet, formatSummary } from '../../scripts/ops/goldenPromptHarness'

test('golden prompt harness recognizes fiscal-year count prompt as deterministic', () => {
  const result = evaluateGoldenPromptSet([
    {
      id: 'fiscal-year-count',
      prompt: 'در دیتابیس چند سال مالی قرار داره؟',
      expectedIntentId: 'count_fiscal_years',
      expectedMode: 'deterministic'
    }
  ])

  assert.equal(result.total, 1)
  assert.equal(result.passed, 1)
  assert.equal(result.failures.length, 0)
  assert.equal(result.results[0]?.intentId, 'count_fiscal_years')
  assert.equal(result.results[0]?.responseMode, 'deterministic')
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

test('golden prompt harness reports stable scoring for deterministic fiscal-year prompts', () => {
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
  assert.equal(result.passed, 1)
  assert.equal(result.score, 100)
  assert.equal(result.maxScore, 100)
  assert.equal(result.results[0]?.checks.intent, true)
  assert.equal(result.results[0]?.checks.mode, true)
  assert.equal(result.results[0]?.checks.tool, true)
  assert.equal(result.results[0]?.checks.evidence, true)
})

test('default golden set contains a stable manager-facing suite', () => {
  assert.ok(DEFAULT_GOLDEN_CASES.length >= 6)
  assert.ok(DEFAULT_GOLDEN_CASES.some((item) => item.expectedIntentId === 'count_fiscal_years'))
  assert.ok(DEFAULT_GOLDEN_CASES.some((item) => item.expectedIntentId === 'get_receivables_summary'))
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

  assert.match(summary, /Score: 100\/100/)
})
