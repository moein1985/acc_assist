/**
 * S39.1-S39.12: Recovery Ladder — the core of orchestration persistence.
 *
 * Instead of immediately refusing when the primary path fails, the recovery ladder
 * tries multiple strategies in order before giving up:
 *
 * Step 1: Catalog metric (fast, deterministic) — already tried by engine.run()
 * Step 2: Alternative/synonym metric
 * Step 3: Investigator loop (schema exploration + entity resolution)
 * Step 4: Clarify (ask user for disambiguation)
 * Step 5: Honest refusal (with explanation of what was tried)
 *
 * Safety invariant: persistence is ONLY in exploration (read-only); every final
 * number must come from a real query + Verifier. Never model-generated numbers.
 *
 * Budget: recoveryTimeoutMs=8000 for the entire ladder beyond step 1.
 */

import type { MetricPlan, MetricId, EngineVerdict, EngineResult } from './types'
import type { SqlQueryRow } from '../../../shared/contracts'
import { getMetricCatalog } from './metricCatalog'
import { buildDeterministicPlan } from './planner'
import { shouldInvestigate, investigate, DEFAULT_BUDGET, type InvestigatorDeps, SchemaCache } from './investigator'
import { evaluateEngineEvidence } from './verifier'

// ─── S39.2: Budget Configuration ───

export interface RecoveryBudget {
  /** Max total time for the recovery ladder (steps 2-5), ms */
  timeoutMs: number
  /** Max number of alternative metrics to try in step 2 */
  maxAlternatives: number
  /** Max Investigator queries (subset of its own budget) */
  maxInvestigatorQueries: number
}

export const DEFAULT_RECOVERY_BUDGET: RecoveryBudget = {
  timeoutMs: 8000,
  maxAlternatives: 3,
  maxInvestigatorQueries: 60,
}

// ─── S39.4: Failure types that trigger recovery ───

export type RecoveryTrigger =
  | 'no-metric-match'
  | 'intent-mismatch'
  | 'planner-error'
  | 'execution-error'
  | 'empty-result'
  | 'verifier-rejected'
  | 'model-prose'

export interface RecoveryContext {
  prompt: string
  trigger: RecoveryTrigger
  failedMetricId?: string
  failReason?: string
}

// ─── S39.11: Recovery step trace (for transparency) ───

export interface RecoveryStep {
  step: number
  name: string
  tried: string
  outcome: 'success' | 'failed' | 'skipped'
  durationMs: number
  detail?: string
}

export interface RecoveryResult {
  /** Final outcome */
  outcome: 'answer' | 'clarify' | 'refuse'
  /** If answer: the engine result */
  result?: EngineResult
  verdict?: EngineVerdict
  /** If clarify: the clarification message */
  clarifyMessage?: string
  /** If refuse: honest explanation of what was tried */
  refuseReason?: string
  /** S39.11: Full trace of steps attempted */
  steps: RecoveryStep[]
  /** Total time spent in recovery */
  totalDurationMs: number
}

// ─── S39.3b: Semantic Verifier (sanity checks) ───

export interface SemanticCheck {
  passed: boolean
  reason?: string
}

/**
 * S39.3b: Verify that a result makes semantic sense.
 * This is a guard against the increased risk of wrong numbers
 * when persistence tries multiple paths.
 */
export function semanticVerify(metricId: string, rows: SqlQueryRow[]): SemanticCheck {
  if (!rows || rows.length === 0) return { passed: true }

  const value = Number(rows[0]?.['result_value'] ?? 0)

  // Sales/revenue should not be negative
  if (['net_sales', 'total_revenue', 'sales_count'].includes(metricId)) {
    if (value < 0) {
      return { passed: false, reason: `semantic: ${metricId} should not be negative (got ${value})` }
    }
  }

  // Purchases/COGS should not be negative
  if (['purchases', 'cogs'].includes(metricId)) {
    if (value < 0) {
      return { passed: false, reason: `semantic: ${metricId} should not be negative (got ${value})` }
    }
  }

  // Counts should not be negative
  if (metricId.includes('count') || metricId.includes('_list')) {
    if (value < 0) {
      return { passed: false, reason: `semantic: count metric ${metricId} should not be negative (got ${value})` }
    }
  }

  // Percentages/ratios: warn if wildly out of range (but don't block)
  if (metricId.includes('ratio') || metricId.includes('margin')) {
    if (Math.abs(value) > 10000) {
      return { passed: false, reason: `semantic: ratio/margin ${metricId} seems unreasonable (got ${value})` }
    }
  }

  return { passed: true }
}

// ─── S39.1: Step 2 — Find alternative/synonym metric ───

/**
 * Find metrics that are semantically similar to the failed one.
 * Uses shared anchors and related metric relationships.
 */
export function findAlternativeMetrics(prompt: string, failedMetricId?: string): MetricId[] {
  const alternatives: MetricId[] = []
  const normalizedPrompt = prompt.toLowerCase()

  // Try all metrics that share at least one anchor word with the prompt
  for (const def of getMetricCatalog()) {
    if (def.id === failedMetricId) continue
    if (alternatives.length >= 3) break

    const hasAnchorMatch = def.anchors.some((anchor) =>
      normalizedPrompt.includes(anchor.toLowerCase())
    )
    if (hasAnchorMatch) {
      alternatives.push(def.id as MetricId)
    }
  }

  return alternatives
}

// ─── S39.1: Main Recovery Ladder ───

export interface RecoveryDeps {
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  normalizePersianText: (input: string) => string
  runPlan: (plan: MetricPlan, signal?: AbortSignal) => Promise<{ verdict: EngineVerdict; result: EngineResult | null }>
}

/**
 * S39.1: Execute the recovery ladder for a failed query.
 * Called when the primary engine path fails (step 1 already tried).
 */
export async function runRecoveryLadder(
  ctx: RecoveryContext,
  deps: RecoveryDeps,
  schemaCache: SchemaCache,
  budget: RecoveryBudget = DEFAULT_RECOVERY_BUDGET,
  signal?: AbortSignal
): Promise<RecoveryResult> {
  const startTime = Date.now()
  const steps: RecoveryStep[] = []

  const isTimedOut = () => Date.now() - startTime > budget.timeoutMs
  const elapsed = () => Date.now() - startTime

  // ─── Step 2: Alternative/synonym metric ───
  if (!isTimedOut()) {
    const stepStart = Date.now()
    const alternatives = findAlternativeMetrics(ctx.prompt, ctx.failedMetricId)

    if (alternatives.length > 0) {
      for (const altMetricId of alternatives.slice(0, budget.maxAlternatives)) {
        if (isTimedOut()) break

        const altPlan = buildDeterministicPlan(ctx.prompt, altMetricId)
        if (!altPlan) continue

        try {
          const altResult = await deps.runPlan(altPlan, signal)
          if (altResult.verdict.ok && altResult.result) {
            // S39.3b: Semantic sanity check
            const semanticCheck = semanticVerify(altMetricId, altResult.result.rows)
            if (semanticCheck.passed) {
              steps.push({
                step: 2,
                name: 'alternative-metric',
                tried: altMetricId,
                outcome: 'success',
                durationMs: Date.now() - stepStart
              })
              return {
                outcome: 'answer',
                result: altResult.result,
                verdict: altResult.verdict,
                steps,
                totalDurationMs: elapsed()
              }
            } else {
              steps.push({
                step: 2,
                name: 'alternative-metric',
                tried: altMetricId,
                outcome: 'failed',
                durationMs: Date.now() - stepStart,
                detail: semanticCheck.reason
              })
            }
          }
        } catch {
          // Alternative failed, continue
        }
      }

      if (steps.length === 0 || steps[steps.length - 1]?.outcome !== 'success') {
        steps.push({
          step: 2,
          name: 'alternative-metric',
          tried: alternatives.join(', '),
          outcome: 'failed',
          durationMs: Date.now() - stepStart,
          detail: 'no alternative produced valid result'
        })
      }
    } else {
      steps.push({
        step: 2,
        name: 'alternative-metric',
        tried: '(none found)',
        outcome: 'skipped',
        durationMs: Date.now() - stepStart
      })
    }
  }

  // ─── Step 3: Investigator loop ───
  if (!isTimedOut() && shouldInvestigate(ctx.prompt, !!ctx.failedMetricId, true)) {
    const stepStart = Date.now()
    const investigatorDeps: InvestigatorDeps = {
      executeReadOnlySql: (q, s) => deps.executeReadOnlySql(q, s),
      normalizePersianText: deps.normalizePersianText,
    }

    // S39.2: Investigator gets remaining budget (capped)
    const remainingMs = budget.timeoutMs - elapsed()
    const investigatorBudget = {
      ...DEFAULT_BUDGET,
      maxQueries: Math.min(budget.maxInvestigatorQueries, DEFAULT_BUDGET.maxQueries),
      timeoutMs: Math.min(remainingMs, 5000), // Cap at 5s for investigator
    }

    try {
      const investigation = await investigate(
        ctx.prompt,
        investigatorDeps,
        signal,
        investigatorBudget,
        schemaCache
      )

      if (investigation.kind === 'answer' && investigation.clusters.length > 0) {
        const cluster = investigation.clusters[0]!
        const investigatorResult: EngineResult = {
          rows: [{
            result_value: cluster.netBalance,
            account_title: cluster.accountTitle,
            account_code: cluster.accountCode,
            total_debit: cluster.totalDebit,
            total_credit: cluster.totalCredit,
            voucher_count: cluster.voucherCount,
            partner_title: cluster.partnerTitle ?? '',
          }],
          plan: {
            metricId: 'account_turnover' as MetricId,
            grain: 'total',
            filters: [],
            confidence: 0.7,
          },
          compiled: {
            sql: `-- recovery-investigator: ${investigation.queryBudgetUsed} queries`,
            bindingsDescription: 'recovery ladder investigator result',
          },
        }

        // S39.3: Evidence contract + S39.3b: Semantic check on investigator result
        const evidenceVerdict = evaluateEngineEvidence(investigatorResult)
        const semanticCheck = semanticVerify('account_turnover', investigatorResult.rows)
        if (evidenceVerdict.kind !== 'INSUFFICIENT' && semanticCheck.passed) {
          steps.push({
            step: 3,
            name: 'investigator',
            tried: `${investigation.queryBudgetUsed} queries, ${investigation.evidence.length} evidence`,
            outcome: 'success',
            durationMs: Date.now() - stepStart
          })
          return {
            outcome: 'answer',
            result: investigatorResult,
            verdict: { ok: true, reason: undefined, reconciliations: [] },
            steps,
            totalDurationMs: elapsed()
          }
        } else {
          steps.push({
            step: 3,
            name: 'investigator',
            tried: `${investigation.queryBudgetUsed} queries`,
            outcome: 'failed',
            durationMs: Date.now() - stepStart,
            detail: semanticCheck.reason
          })
        }
      } else if (investigation.kind === 'clarify') {
        steps.push({
          step: 3,
          name: 'investigator',
          tried: `${investigation.queryBudgetUsed} queries → clarify`,
          outcome: 'success',
          durationMs: Date.now() - stepStart
        })
        return {
          outcome: 'clarify',
          clarifyMessage: investigation.message,
          steps,
          totalDurationMs: elapsed()
        }
      } else if (investigation.kind === 'refuse') {
        steps.push({
          step: 3,
          name: 'investigator',
          tried: `${investigation.queryBudgetUsed} queries → ${investigation.reason}`,
          outcome: 'failed',
          durationMs: Date.now() - stepStart
        })
      } else {
        // kind === 'answer' but clusters.length === 0
        steps.push({
          step: 3,
          name: 'investigator',
          tried: `${investigation.queryBudgetUsed} queries → no clusters`,
          outcome: 'failed',
          durationMs: Date.now() - stepStart
        })
      }
    } catch {
      steps.push({
        step: 3,
        name: 'investigator',
        tried: 'exception',
        outcome: 'failed',
        durationMs: Date.now() - stepStart,
        detail: 'investigator threw an error'
      })
    }
  } else if (isTimedOut()) {
    steps.push({
      step: 3,
      name: 'investigator',
      tried: '(timed out)',
      outcome: 'skipped',
      durationMs: 0
    })
  }

  // ─── Step 4: Clarify — if we have some context, ask the user ───
  if (!isTimedOut() && ctx.failedMetricId) {
    steps.push({
      step: 4,
      name: 'clarify',
      tried: `metric=${ctx.failedMetricId}, trigger=${ctx.trigger}`,
      outcome: 'success',
      durationMs: 0
    })
    return {
      outcome: 'clarify',
      clarifyMessage: buildRecoveryClarifyMessage(ctx),
      steps,
      totalDurationMs: elapsed()
    }
  }

  // ─── Step 5: Honest refusal with explanation ───
  steps.push({
    step: 5,
    name: 'honest-refusal',
    tried: `trigger=${ctx.trigger}, failedMetric=${ctx.failedMetricId ?? 'none'}`,
    outcome: 'success',
    durationMs: 0
  })

  return {
    outcome: 'refuse',
    refuseReason: buildHonestRefusal(ctx, steps),
    steps,
    totalDurationMs: elapsed()
  }
}

// ─── S39.12: Honest refusal message builder ───

function buildRecoveryClarifyMessage(ctx: RecoveryContext): string {
  const base = 'لطفاً پرسش خود را دقیق‌تر مشخص کنید.'
  if (ctx.failedMetricId) {
    return `متریک «${ctx.failedMetricId}» تلاش شد ولی نتیجه‌ای نداشت. ${base}`
  }
  return base
}

function buildHonestRefusal(ctx: RecoveryContext, steps: RecoveryStep[]): string {
  const tried = steps
    .filter(s => s.outcome !== 'skipped')
    .map(s => `${s.name} (${s.tried})`)
    .join(' → ')

  return `recovery-exhausted: trigger=${ctx.trigger}, tried=[${tried}]`
}
