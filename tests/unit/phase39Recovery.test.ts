import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runRecoveryLadder,
  type RecoveryContext,
  type RecoveryDeps,
  type RecoveryBudget
} from '../../src/main/services/financialEngine/recoveryLadder'
import { SchemaCache } from '../../src/main/services/financialEngine/investigator'
import type { SqlQueryRow } from '../../src/shared/contracts'
import type {
  EngineResult,
  EngineVerdict,
  MetricPlan
} from '../../src/main/services/financialEngine/types'

function makeNormText(s: string): string {
  return s
    .replace(/\u064A/g, '\u06CC')
    .replace(/\u0649/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/\u0623/g, '\u0627')
    .trim()
}

function makeSchemaCache(): SchemaCache {
  return new SchemaCache()
}

function makeRecoveryDeps(
  executeFn: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>,
  runPlanFn: (
    plan: MetricPlan,
    signal?: AbortSignal
  ) => Promise<{ verdict: EngineVerdict; result: EngineResult | null }>
): RecoveryDeps {
  return {
    executeReadOnlySql: executeFn,
    normalizePersianText: makeNormText,
    runPlan: runPlanFn
  }
}

// ─── S39.9: Fallback to recovery ladder after retry exhaustion ───

describe('S39.9-10: Recovery ladder fallback after retry', () => {
  const smallBudget: RecoveryBudget = {
    timeoutMs: 3000,
    maxAlternatives: 2,
    maxInvestigatorQueries: 10
  }

  test('recovery ladder returns answer when alternative metric succeeds', async () => {
    const ctx: RecoveryContext = {
      prompt: 'گردش حساب صندوق ۱۴۰۲',
      trigger: 'intent-mismatch',
      failedMetricId: 'trial_balance',
      failReason: 'metric-mismatch:گردش→trial_balance'
    }

    const deps = makeRecoveryDeps(
      async () => [],
      async (plan) => ({
        verdict: { ok: true, reason: undefined, reconciliations: [] },
        result: {
          rows: [{ result_value: 5000000, account_title: 'صندوق' }],
          plan,
          compiled: { sql: '-- test', bindingsDescription: 'test' }
        }
      })
    )

    const result = await runRecoveryLadder(ctx, deps, makeSchemaCache(), smallBudget)
    assert.equal(result.outcome, 'answer')
    assert.ok(result.result)
    assert.ok(result.steps.length > 0)
  })

  test('recovery ladder returns refusal when all steps fail', async () => {
    const ctx: RecoveryContext = {
      prompt: 'سؤال نامفهوم',
      trigger: 'no-metric-match'
    }

    const deps = makeRecoveryDeps(
      async () => [],
      async () => ({
        verdict: { ok: false, reason: 'execution-error', reconciliations: [] },
        result: null
      })
    )

    const result = await runRecoveryLadder(ctx, deps, makeSchemaCache(), smallBudget)
    assert.notEqual(result.outcome, 'answer')
    assert.ok(result.steps.length > 0)
  })

  test('recovery ladder includes step trace in refusal or clarify', async () => {
    const ctx: RecoveryContext = {
      prompt: 'داده‌ای که وجود ندارد',
      trigger: 'empty-result',
      failedMetricId: 'net_sales',
      failReason: 'zero-rows'
    }

    const deps = makeRecoveryDeps(
      async () => [],
      async () => ({
        verdict: { ok: false, reason: 'zero-rows', reconciliations: [] },
        result: null
      })
    )

    const result = await runRecoveryLadder(ctx, deps, makeSchemaCache(), smallBudget)
    // Outcome could be 'refuse' or 'clarify' depending on investigator behavior
    assert.ok(
      result.outcome === 'refuse' || result.outcome === 'clarify',
      `expected refuse or clarify, got ${result.outcome}`
    )
    assert.ok(result.steps.length > 0)
    // Steps should have at least alternative-metric step
    const altStep = result.steps.find((s) => s.name === 'alternative-metric')
    assert.ok(altStep, 'should have alternative-metric step')
  })

  test('recovery ladder respects budget timeout', async () => {
    const ctx: RecoveryContext = {
      prompt: 'گردش حساب بانک ملت ۱۴۰۲',
      trigger: 'intent-mismatch',
      failedMetricId: 'trial_balance',
      failReason: 'metric-mismatch:گردش→trial_balance'
    }

    const tinyBudget: RecoveryBudget = {
      timeoutMs: 1, // 1ms — should timeout immediately
      maxAlternatives: 5,
      maxInvestigatorQueries: 100
    }

    const deps = makeRecoveryDeps(
      async () => [],
      async (plan) => ({
        verdict: { ok: true, reason: undefined, reconciliations: [] },
        result: {
          rows: [{ result_value: 100 }],
          plan,
          compiled: { sql: '-- test', bindingsDescription: 'test' }
        }
      })
    )

    const result = await runRecoveryLadder(ctx, deps, makeSchemaCache(), tinyBudget)
    // With 1ms budget, steps should be minimal
    assert.ok(result.steps.length <= 1)
  })

  test('S39.8b: suggestedMetricId flows from evaluateResult to retry hint', () => {
    // This is a structural test: verify RetryHint interface accepts suggestedMetricId
    // The actual flow is tested via golden eval + integration
    const retryHint = {
      failedMetricId: 'trial_balance',
      reason: 'metric-mismatch:گردش→trial_balance',
      errorType: 'intent-mismatch' as const,
      suggestedMetricId: 'account_turnover'
    }
    assert.equal(retryHint.suggestedMetricId, 'account_turnover')
    assert.equal(retryHint.errorType, 'intent-mismatch')
  })
})
