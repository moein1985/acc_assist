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
import { buildDeterministicPlan } from './planner'
import { findMetricById } from './metricCatalog'
import { compileMetricPlan, type CompilerDeps } from './compiler'

export interface EngineDeps extends CompilerDeps {
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
}

export interface EngineRunResult {
  verdict: EngineVerdict
  result: EngineResult | null
}

export class FinancialEngine {
  constructor(private deps: EngineDeps) {}

  async run(prompt: string, signal?: AbortSignal): Promise<EngineRunResult> {
    const route = routeMetric(prompt)
    if (!route.metricId || route.confidence < 0.5) {
      return {
        verdict: { ok: false, reason: 'no-metric-match', reconciliations: [] },
        result: null
      }
    }

    const plan = buildDeterministicPlan(prompt, route.metricId)
    if (!plan) {
      return {
        verdict: { ok: false, reason: 'plan-failed', reconciliations: [] },
        result: null
      }
    }

    return this.runPlan(plan, signal)
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
      return {
        verdict: { ok: true, reconciliations: [] },
        result
      }
    } catch (error) {
      void error
      return {
        verdict: { ok: false, reason: 'execution-error', reconciliations: [] },
        result: null
      }
    }
  }
}
