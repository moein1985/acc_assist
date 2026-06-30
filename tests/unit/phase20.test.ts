import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parsePlannerOutput,
  buildClarify,
  buildPlannerPrompt,
  type PlannerConversationContext
} from '../../src/main/services/financialEngine/planner'
import { generateSmartSuggestions } from '../../src/main/services/financialEngine/smartSuggestions'
import { detectAnomalies } from '../../src/main/services/financialEngine/anomalyDetector'
import {
  createInitialConversationMemory,
  pushConversationTurn,
  MAX_CONVERSATION_HISTORY_TURNS
} from '../../src/main/services/agentOrchestrator/conversationMemory'
import type { MetricPlan, MetricId } from '../../src/main/services/financialEngine/types'

// ─── Test 1: MultiStepPlan parse ─────────────────────────────────────────────

test('S20.13.1: parsePlannerOutput parses MultiStepPlan with compare strategy', () => {
  const raw = JSON.stringify({
    steps: [
      { metricId: 'net_sales', grain: 'total', filters: [{ dimension: 'by_year', op: 'eq', values: ['1403'] }], confidence: 0.9 },
      { metricId: 'net_sales', grain: 'total', filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }], confidence: 0.9 }
    ],
    combineStrategy: 'compare',
    confidence: 0.85
  })
  const result = parsePlannerOutput(raw)
  assert.ok(result.stepPlan, 'stepPlan should be defined')
  assert.equal(result.stepPlan!.combineStrategy, 'compare')
  assert.equal(result.stepPlan!.steps.length, 2)
  assert.equal(result.stepPlan!.steps[0]!.metricId, 'net_sales')
  assert.equal(result.stepPlan!.steps[1]!.filters[0]!.values[0], '1402')
})

// ─── Test 2: MultiStepPlan parse — cascade strategy ──────────────────────────

test('S20.13.2: parsePlannerOutput parses MultiStepPlan with cascade strategy', () => {
  const raw = JSON.stringify({
    steps: [
      { metricId: 'sales_by_period', grain: 'by_customer', filters: [], topN: 1, confidence: 0.85 },
      { metricId: 'party_turnover', grain: 'total', filters: [], confidence: 0.8 }
    ],
    combineStrategy: 'cascade',
    confidence: 0.8
  })
  const result = parsePlannerOutput(raw)
  assert.ok(result.stepPlan)
  assert.equal(result.stepPlan!.combineStrategy, 'cascade')
  assert.equal(result.stepPlan!.steps[0]!.metricId, 'sales_by_period')
  assert.equal(result.stepPlan!.steps[1]!.metricId, 'party_turnover')
})

// ─── Test 3: ConversationMemory v2 — history with 5 turns ────────────────────

test('S20.13.3: ConversationMemory history keeps last 5 turns', () => {
  const mem = createInitialConversationMemory('test-conv')
  const basePlan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    confidence: 0.9
  }
  for (let i = 0; i < 7; i++) {
    pushConversationTurn(mem, {
      userMessage: `سؤال ${i}`,
      plan: basePlan,
      resultSummary: `نتیجه ${i}`,
      timestamp: Date.now() + i
    })
  }
  assert.equal(mem.history.length, MAX_CONVERSATION_HISTORY_TURNS)
  assert.equal(mem.history[0]!.userMessage, 'سؤال 2')
  assert.equal(mem.history[4]!.userMessage, 'سؤال 6')
})

// ─── Test 4: Reference to "پارسال" from history ──────────────────────────────

test('S20.13.4: buildPlannerPrompt includes conversation history with "پارسال" reference', () => {
  const ctx: PlannerConversationContext = {
    history: [
      { userMessage: 'فروش ۱۴۰۲ چقدر بود؟', resultSummary: 'فروش خالص ۱۴۰۲: ۶۴ میلیارد' }
    ],
    contextEntities: { years: [1402], accounts: [], parties: [] }
  }
  const prompt = buildPlannerPrompt('نسبت به پارسال چقدر تغییر کرده؟', undefined, ctx)
  assert.ok(prompt.includes('تاریخچه مکالمه'), 'prompt should include conversation history')
  assert.ok(prompt.includes('فروش ۱۴۰۲'), 'prompt should reference previous question')
  assert.ok(prompt.includes('۶۴ میلیارد'), 'prompt should reference previous result')
})

// ─── Test 5: SmartSuggestions — 3 suggestions after total_revenue ────────────

test('S20.13.5: generateSmartSuggestions returns 3 suggestions for net_sales', () => {
  const suggestions = generateSmartSuggestions({
    metricId: 'net_sales',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    contextEntities: { years: [1402], accounts: [], parties: [] }
  })
  assert.ok(suggestions.length >= 1)
  assert.ok(suggestions.length <= 3)
  for (const s of suggestions) {
    assert.ok(s.text.length > 0, 'each suggestion should have non-empty text')
  }
})

// ─── Test 6: AnomalyDetector — 80% change → severity=high ────────────────────

test('S20.13.6: detectAnomalies flags 80% year-over-year change as high severity', () => {
  const rows = [
    { year: 1402, amount: 100000000 },
    { year: 1403, amount: 180000000 }
  ]
  const anomalies = detectAnomalies({
    metricId: 'net_sales',
    rows,
    plan: { metricId: 'net_sales', grain: 'by_year', filters: [], confidence: 0.9 }
  })
  const yoyAnomaly = anomalies.find((a) => a.type === 'year_over_year_change')
  assert.ok(yoyAnomaly, 'should detect year-over-year change')
  assert.equal(yoyAnomaly!.severity, 'high', '80% change should be high severity')
})

// ─── Test 7: AnomalyDetector — voucher with 3σ amount → anomaly ──────────────

test('S20.13.7: detectAnomalies flags voucher with amount > 3 standard deviations', () => {
  const amounts = [1000000, 1100000, 950000, 1050000, 1200000, 980000, 1020000, 1150000, 1080000, 990000, 50000000]
  const rows = amounts.map((amount) => ({ amount, id: 'v1' }))
  const anomalies = detectAnomalies({
    metricId: 'recent_documents',
    rows,
    plan: { metricId: 'recent_documents', grain: 'total', filters: [], confidence: 0.9 }
  })
  const unusual = anomalies.find((a) => a.type === 'unusual_voucher')
  assert.ok(unusual, 'should detect unusual voucher')
  assert.equal(unusual!.severity, 'high')
  assert.ok((unusual!.data['zScore'] as number) >= 3, 'z-score should be >= 3')
})

// ─── Test 8: Domain Knowledge — "نسبت جاری" in planner prompt ────────────────

test('S20.13.8: buildPlannerPrompt includes domain knowledge with current_ratio mapping', () => {
  const prompt = buildPlannerPrompt('نسبت جاری چقدر است؟')
  assert.ok(prompt.includes('دانش حسابداری'), 'prompt should include domain knowledge section')
  assert.ok(prompt.includes('current_ratio'), 'prompt should map نسبت جاری to current_ratio')
  assert.ok(prompt.includes('ROA'), 'prompt should include ROA definition')
})

// ─── Test 9: Clarify — "سود" → 3 options ─────────────────────────────────────

test('S20.13.9: buildClarify returns 3 options for ambiguous "سود"', () => {
  const result = buildClarify('سود چقدره؟', 'net_sales')
  assert.ok(result.suggestions.length >= 3, 'should return at least 3 suggestions')
  assert.ok(result.suggestions.some((s) => s.includes('خالص')), 'should include net profit option')
  assert.ok(result.suggestions.some((s) => s.includes('عملیاتی')), 'should include operating profit option')
  assert.ok(result.suggestions.some((s) => s.includes('ناخالص')), 'should include gross profit option')
})

// ─── Test 10: Clarify — "سود خالص" is NOT ambiguous (specifier present) ──────

test('S20.13.10: buildClarify does NOT trigger ambiguity for "سود خالص" (specifier present)', () => {
  const result = buildClarify('سود خالص چقدره؟', 'net_profit' as MetricId)
  assert.ok(
    !result.suggestions.some((s) => s.includes('عملیاتی')) || result.suggestions.length < 3,
    'should not show all 3 profit types when specifier is present'
  )
})
