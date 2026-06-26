/**
 * FinancialEngine — orchestrates the plan → compile → exec → verify → explain pipeline.
 *
 * Phase 1: no-op stub. None of these methods are called yet.
 * Phase 2+ will wire the actual pipeline.
 *
 * @see FRE_ROADMAP_00_OVERVIEW.fa.md
 */

import type { EngineResult, EngineVerdict, MetricPlan } from './types'
import type { SqlQueryRow } from '../../../shared/contracts'
import { routeMetric } from './router'
import {
  buildDeterministicPlan,
  buildModelPlan,
  PLANNER_CONFIDENCE_THRESHOLD,
  type PlannerModelDeps
} from './planner'
import { findMetricById } from './metricCatalog'
import { compileMetricPlan, type CompilerDeps } from './compiler'
import { verifyResult } from './verifier'

export interface EngineDeps extends CompilerDeps {
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  plannerModel?: PlannerModelDeps
}

export interface EngineRunResult {
  verdict: EngineVerdict
  result: EngineResult | null
}

export class FinancialEngine {
  constructor(private deps: EngineDeps) {}

  async run(prompt: string, signal?: AbortSignal): Promise<EngineRunResult> {
    const route = routeMetric(prompt)

    // Step 1: If router is confident, use deterministic plan (fast, no model cost)
    if (route.metricId && route.confidence >= 0.7) {
      const plan = buildDeterministicPlan(prompt, route.metricId)
      if (plan) {
        return this.runPlan(plan, signal)
      }
    }

    // Step 2: If model planner is available, try it for ambiguous/complex prompts
    if (this.deps.plannerModel) {
      const modelResult = await buildModelPlan(prompt, this.deps.plannerModel)
      if (modelResult.plan && modelResult.plan.confidence >= PLANNER_CONFIDENCE_THRESHOLD) {
        return this.runPlan(modelResult.plan, signal)
      }

      // Step 3: Low confidence or invalid plan → clarify
      if (modelResult.plan && modelResult.plan.confidence < PLANNER_CONFIDENCE_THRESHOLD) {
        return {
          verdict: {
            ok: false,
            reason: 'low-confidence-clarify',
            reconciliations: []
          },
          result: null
        }
      }

      // Parse error → degrade
      if (modelResult.error) {
        return {
          verdict: {
            ok: false,
            reason: `planner-error: ${modelResult.error}`,
            reconciliations: []
          },
          result: null
        }
      }
    }

    // Step 4: No metric match → degrade to legacy
    return {
      verdict: {
        ok: false,
        reason: route.metricId ? 'plan-failed' : 'no-metric-match',
        reconciliations: []
      },
      result: null
    }
  }

  async runPlan(plan: MetricPlan, signal?: AbortSignal): Promise<EngineRunResult> {
    const def = findMetricById(plan.metricId)
    if (!def) {
      return {
        verdict: { ok: false, reason: 'metric-not-found', reconciliations: [] },
        result: null
      }
    }

    try {
      const compiled = compileMetricPlan(plan, def, this.deps)
      let rows = await this.deps.executeReadOnlySql(compiled.sql, signal)

      if (rows.length === 0 || (rows.length === 1 && !rows[0]['result_value'])) {
        if (def.source.fallbackTables && def.source.fallbackTables.length > 0) {
          for (const fallback of def.source.fallbackTables) {
            const fallbackPlan: MetricPlan = {
              ...plan,
              metricId: plan.metricId
            }
            const fallbackDef = {
              ...def,
              source: { primaryTable: fallback.table, alias: fallback.alias },
              measure: fallback.measure,
              mandatoryFilters: [...def.mandatoryFilters, ...(fallback.filters ?? [])]
            }
            try {
              const fallbackCompiled = compileMetricPlan(fallbackPlan, fallbackDef, this.deps)
              const fallbackRows = await this.deps.executeReadOnlySql(fallbackCompiled.sql, signal)
              if (fallbackRows.length > 0 && fallbackRows[0]['result_value']) {
                rows = fallbackRows
                break
              }
            } catch {
              // continue to next fallback
            }
          }
        }
      }

      const result: EngineResult = { rows, plan, compiled }
      const verdict = verifyResult(result, plan, def)
      return { verdict, result }
    } catch (error) {
      void error
      return {
        verdict: { ok: false, reason: 'execution-error', reconciliations: [] },
        result: null
      }
    }
  }
}
