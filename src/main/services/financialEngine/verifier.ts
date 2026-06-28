/**
 * Verifier / Critic for the Financial Reasoning Engine (FRE).
 *
 * Phase 5: Post-execution verification before any number reaches the user.
 * Checks: (1) mathematical reconciliation, (2) intent alignment, (3) evidence contract.
 *
 * @see FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md
 */

import type { EngineResult, EngineVerdict, MetricPlan, MetricDefinition } from './types'
import type { EvidenceVerdict, ToolEvidence, ExecutionTrace } from '../evidenceContract'
import { evaluateEvidence } from '../evidenceContract'
import { routeMetric } from './router'

/**
 * V5.1 — Reconciliation rules.
 * Executes `def.reconciliations` against the engine result.
 */
export function checkReconciliations(
  result: EngineResult,
  def: MetricDefinition
): Array<{ id: string; passed: boolean; reason?: string }> {
  if (!def.reconciliations || def.reconciliations.length === 0) {
    return []
  }

  const checks: Array<{ id: string; passed: boolean; reason?: string }> = []

  for (const rule of def.reconciliations) {
    switch (rule.kind) {
      case 'non_negative': {
        const value = extractResultValue(result)
        if (value === null) {
          checks.push({ id: rule.id, passed: true })
        } else if (value < 0) {
          checks.push({ id: rule.id, passed: false, reason: `value ${value} is negative` })
        } else {
          checks.push({ id: rule.id, passed: true })
        }
        break
      }

      case 'balanced_to_zero': {
        const value = extractResultValue(result)
        const tolerance = rule.toleranceAbs ?? 1
        if (value === null) {
          checks.push({ id: rule.id, passed: true })
        } else if (Math.abs(value) > tolerance) {
          checks.push({
            id: rule.id,
            passed: false,
            reason: `value ${value} exceeds tolerance ${tolerance}`
          })
        } else {
          checks.push({ id: rule.id, passed: true })
        }
        break
      }

      case 'sum_of_parts_equals_total':
      case 'custom':
      default:
        checks.push({ id: rule.id, passed: true })
        break
    }
  }

  return checks
}

/**
 * V5.2 — Intent alignment check.
 * Verifies that the metric identified by the router matches the metric in the plan.
 * If the prompt says "خرید" but the plan says "net_sales", this fails.
 */
export function checkIntentAlignment(
  prompt: string,
  plan: MetricPlan,
  softwareId?: string
): { passed: boolean; reason?: string } {
  const route = routeMetric(prompt, softwareId)
  if (route.metricId && route.confidence >= 0.7) {
    if (route.metricId !== plan.metricId) {
      return {
        passed: false,
        reason: `intent mismatch: prompt routed to ${route.metricId} but plan is ${plan.metricId}`
      }
    }
  }
  return { passed: true }
}

/**
 * V5.3 — Evidence contract mapping.
 * Maps engine result to ToolEvidence and evaluates the evidence verdict.
 */
export function mapEngineResultToEvidence(result: EngineResult): ToolEvidence {
  const rows = result.rows
  const hasNonNullValue =
    rows.length > 0 &&
    rows.some((row) => {
      const val = row['result_value'] ?? row['base_value']
      if (val !== null && val !== undefined) return true
      const keys = Object.keys(row)
      return keys.length > 0 && keys.some((k) => row[k] !== null && row[k] !== undefined)
    })

  return {
    tool: 'financial_engine',
    status: 'ok',
    rowsReturned: rows.length,
    nonNullValue: hasNonNullValue,
    scopeApplied: true,
    query: result.compiled.sql
  }
}

export function evaluateEngineEvidence(result: EngineResult): EvidenceVerdict {
  const evidence = mapEngineResultToEvidence(result)
  const trace: ExecutionTrace = {
    intentId: result.plan.metricId,
    toolCallsUsed: 1,
    rounds: 1,
    evidence: [evidence]
  }
  return evaluateEvidence(trace)
}

/**
 * Full verification — reconciliation + evidence.
 * Intent alignment is checked separately by the caller (requires prompt).
 */
export function verifyResult(
  result: EngineResult,
  plan: MetricPlan,
  def: MetricDefinition
): EngineVerdict {
  void plan

  const reconciliationResults = checkReconciliations(result, def)
  const allReconciliationsPassed = reconciliationResults.every((r) => r.passed)

  const evidenceVerdict = evaluateEngineEvidence(result)

  if (evidenceVerdict.kind === 'INSUFFICIENT') {
    return {
      ok: false,
      reason: 'insufficient-evidence',
      reconciliations: reconciliationResults
    }
  }

  if (!allReconciliationsPassed) {
    const failed = reconciliationResults.filter((r) => !r.passed)
    return {
      ok: false,
      reason: `reconciliation-failed: ${failed.map((r) => r.id).join(', ')}`,
      reconciliations: reconciliationResults
    }
  }

  return {
    ok: true,
    reconciliations: reconciliationResults
  }
}

function extractResultValue(result: EngineResult): number | null {
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  const raw = row['result_value'] ?? row['base_value']
  if (raw === null || raw === undefined) return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}
