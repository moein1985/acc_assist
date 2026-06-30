/**
 * FinancialEngine — orchestrates the plan → compile → exec → verify → explain pipeline.
 *
 * Phase 1: no-op stub. None of these methods are called yet.
 * Phase 2+ will wire the actual pipeline.
 *
 * @see FRE_ROADMAP_00_OVERVIEW.fa.md
 */

import type { EngineResult, EngineVerdict, MetricPlan, MultiMetricPlan, DerivedMetric, MetricId, MetricDefinition, PythonOutputPlan } from './types'
import type { SqlQueryRow } from '../../../shared/contracts'
import { routeMetric } from './router'
import { routeDerivedMetric } from './router'
import {
  buildDeterministicPlan,
  buildDeterministicMultiPlan,
  buildModelPlan,
  buildClarify,
  buildFollowUpPlan,
  isDrillDownPrompt,
  PLANNER_CONFIDENCE_THRESHOLD,
  type PlannerModelDeps,
  type ClarifyResult
} from './planner'
import { findMetricById } from './metricCatalog'
import { compileMetricPlan, type CompilerDeps } from './compiler'
import { verifyResult } from './verifier'

export interface EngineDeps extends CompilerDeps {
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  plannerModel?: PlannerModelDeps
  /** S15.22: Active softwareId for adapter-aware routing and planning */
  softwareId?: string
}

export interface EngineRunResult {
  verdict: EngineVerdict
  result: EngineResult | null
  pythonOutput?: PythonOutputResult | null
}

export interface PythonOutputResult {
  success: boolean
  outputFiles: string[]
  outputData?: unknown
  error?: string
  outputType: string
}

export interface MultiMetricResult {
  results: EngineResult[]
  verdicts: EngineVerdict[]
  plan: MultiMetricPlan
}

export type EngineRunOutcome = EngineRunResult | MultiMetricResult

export class FinancialEngine {
  constructor(private deps: EngineDeps) {}

  async run(
    prompt: string,
    signal?: AbortSignal,
    lastPlan?: MetricPlan | null,
    pythonPlan?: PythonOutputPlan | null
  ): Promise<EngineRunOutcome> {
    // S14.40: Conversational drill-down — if prompt is a follow-up and we have a lastPlan,
    // build a plan that inherits metricId and filters from the previous turn
    if (lastPlan && isDrillDownPrompt(prompt)) {
      const followUpPlan = buildFollowUpPlan(prompt, lastPlan)
      if (followUpPlan) {
        return this.runPlan(followUpPlan, signal, pythonPlan)
      }
    }

    // Step -1: Check for derived metric
    const derived = routeDerivedMetric(prompt)
    if (derived) {
      return this.runDerivedMetric(derived, prompt, signal)
    }

    // Step 0: Try multi-metric plan first
    const multiPlan = buildDeterministicMultiPlan(prompt)
    if (multiPlan) {
      return this.runMultiMetric(multiPlan, signal, pythonPlan)
    }

    const route = routeMetric(prompt, this.deps.softwareId)

    // Step 1: If router is confident, use deterministic plan (fast, no model cost)
    if (route.metricId && route.confidence >= 0.7) {
      const plan = buildDeterministicPlan(prompt, route.metricId)
      if (plan) {
        return this.runPlan(plan, signal, pythonPlan)
      }
    }

    // Step 2: If model planner is available, try it for ambiguous/complex prompts
    if (this.deps.plannerModel) {
      const modelResult = await buildModelPlan(prompt, this.deps.plannerModel, this.deps.softwareId)

      // MultiMetricPlan from model
      if (modelResult.multiPlan && modelResult.multiPlan.confidence >= PLANNER_CONFIDENCE_THRESHOLD) {
        return this.runMultiMetric(modelResult.multiPlan, signal, pythonPlan)
      }

      if (modelResult.plan && modelResult.plan.confidence >= PLANNER_CONFIDENCE_THRESHOLD) {
        return this.runPlan(modelResult.plan, signal, pythonPlan)
      }

      // Step 3: Low confidence or invalid plan → clarify
      if (modelResult.plan && modelResult.plan.confidence < PLANNER_CONFIDENCE_THRESHOLD) {
        const clarify: ClarifyResult = buildClarify(prompt, modelResult.plan.metricId)
        return {
          verdict: {
            ok: false,
            reason: `clarify:${JSON.stringify(clarify)}`,
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

  async runDerivedMetric(
    derived: DerivedMetric,
    prompt: string,
    signal?: AbortSignal
  ): Promise<EngineRunResult> {
    try {
      const values: Record<string, number> = {}

      for (const inputId of derived.inputs) {
        const plan = buildDeterministicPlan(prompt, inputId)
        if (!plan) {
          return {
            verdict: { ok: false, reason: `derived-input-plan-failed: ${inputId}`, reconciliations: [] },
            result: null
          }
        }
        const runResult = await this.runPlan(plan, signal)
        if (!runResult.result || !runResult.verdict.ok) {
          return {
            verdict: { ok: false, reason: `derived-input-failed: ${inputId}`, reconciliations: [] },
            result: null
          }
        }
        const raw = runResult.result.rows[0]?.['result_value'] ?? runResult.result.rows[0]?.['base_value']
        values[inputId] = raw !== null && raw !== undefined ? Number(raw) : 0
      }

      const derivedValue = derived.formula(values)
      const fakePlan: MetricPlan = {
        metricId: derived.id as unknown as MetricId,
        grain: 'total',
        filters: [],
        confidence: 1.0
      }
      const result: EngineResult = {
        rows: [{ result_value: derivedValue }],
        plan: fakePlan,
        compiled: { sql: `-- derived: ${derived.id}(${JSON.stringify(values)})`, bindingsDescription: 'derived metric' }
      }

      return {
        verdict: { ok: true, reason: undefined, reconciliations: [] },
        result
      }
    } catch (error) {
      void error
      return {
        verdict: { ok: false, reason: 'derived-execution-error', reconciliations: [] },
        result: null
      }
    }
  }

  async runMultiMetric(plan: MultiMetricPlan, signal?: AbortSignal, pythonPlan?: PythonOutputPlan | null): Promise<MultiMetricResult> {
    const results: EngineResult[] = []
    const verdicts: EngineVerdict[] = []

    for (const subPlan of plan.plans) {
      const runResult = await this.runPlan(subPlan, signal, pythonPlan)
      if (runResult.result) {
        results.push(runResult.result)
      }
      verdicts.push(runResult.verdict)
    }

    return { results, verdicts, plan }
  }

  async runPlan(plan: MetricPlan, signal?: AbortSignal, pythonPlan?: PythonOutputPlan | null): Promise<EngineRunResult> {
    const def = findMetricById(plan.metricId)
    if (!def) {
      return {
        verdict: { ok: false, reason: 'metric-not-found', reconciliations: [] },
        result: null
      }
    }

    const ENGINE_TIMEOUT_MS = 30_000
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), ENGINE_TIMEOUT_MS)

    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal

    try {
      const compiled = compileMetricPlan(plan, def, this.deps)
      let rows: SqlQueryRow[]

      try {
        rows = await this.deps.executeReadOnlySql(compiled.sql, combinedSignal)
      } catch (execError) {
        if (timeoutController.signal.aborted) {
          return {
            verdict: { ok: false, reason: `engine-timeout: ${plan.metricId} exceeded ${ENGINE_TIMEOUT_MS}ms`, reconciliations: [] },
            result: null
          }
        }
        throw execError
      }

      if (rows.length === 0 || (rows.length === 1 && !rows[0]['result_value'])) {
        if (def.source.fallbackTables && def.source.fallbackTables.length > 0) {
          for (const fallback of def.source.fallbackTables) {
            const fallbackPlan: MetricPlan = {
              ...plan,
              metricId: plan.metricId
            }
            const fallbackDef: MetricDefinition = {
              ...def,
              conceptSource: undefined,
              conceptMeasure: undefined,
              conceptDimensions: undefined,
              conceptFilters: undefined,
              conceptDateColumn: undefined,
              conceptEntityNameMatch: undefined,
              source: { primaryTable: fallback.table, alias: fallback.alias },
              measure: fallback.measure,
              mandatoryFilters: [...def.mandatoryFilters, ...(fallback.filters ?? [])]
            }
            try {
              const fallbackCompiled = compileMetricPlan(fallbackPlan, fallbackDef, this.deps)
              const fallbackRows = await this.deps.executeReadOnlySql(fallbackCompiled.sql, combinedSignal)
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

      if (verdict.ok && def.source.compositeSources && def.source.compositeSources.length > 0) {
        let primaryValue = Number(rows[0]['result_value'] ?? 0)
        for (const cs of def.source.compositeSources) {
          const csDef: MetricDefinition = {
            ...def,
            conceptSource: undefined,
            conceptMeasure: undefined,
            conceptDimensions: undefined,
            conceptFilters: undefined,
            conceptDateColumn: undefined,
            conceptEntityNameMatch: undefined,
            source: { primaryTable: cs.table, alias: cs.alias },
            measure: cs.measure,
            mandatoryFilters: [...def.mandatoryFilters, ...(cs.filters ?? [])]
          }
          try {
            const csCompiled = compileMetricPlan(plan, csDef, this.deps)
            const csRows = await this.deps.executeReadOnlySql(csCompiled.sql, combinedSignal)
            if (csRows.length > 0 && csRows[0]['result_value'] != null) {
              primaryValue += Number(csRows[0]['result_value'])
            }
          } catch {
            // composite source failed — skip it
          }
        }
        rows = [{ ...rows[0], result_value: primaryValue }]
      }

      const finalResult: EngineResult = { rows, plan, compiled }
      const finalVerdict = verifyResult(finalResult, plan, def)

      // S18.10: If PythonOutputPlan is enabled, run Python sandbox on the results
      let pythonOutput: PythonOutputResult | null = null
      if (pythonPlan && pythonPlan.enabled && finalVerdict.ok) {
        pythonOutput = await this.runPythonOutput(pythonPlan, plan.metricId, rows, signal)
      }

      return { verdict: finalVerdict, result: finalResult, pythonOutput: pythonOutput }
    } catch (error) {
      void error
      return {
        verdict: { ok: false, reason: 'execution-error', reconciliations: [] },
        result: null
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // S18.10 — Run Python sandbox on SQL results to generate chart/excel/pdf
  private async runPythonOutput(
    plan: PythonOutputPlan,
    metricId: string,
    rows: SqlQueryRow[],
    signal?: AbortSignal
  ): Promise<PythonOutputResult | null> {
    try {
      // Lazy import to avoid loading PythonRunnerService in test environments
      const { PythonRunnerService, validatePythonCode, runPythonCode } = await import('../pythonRunnerService')
      const { generatePythonCode } = await import('./pythonTemplates')

      const runner = new PythonRunnerService()
      if (!runner.isAvailable()) {
        return null
      }

      const code = generatePythonCode(plan, metricId)

      // Validate code via AST
      const validationError = await validatePythonCode(
        runner.getPythonPath(),
        runner.getValidatorPath(),
        code
      )
      if (validationError) {
        return {
          success: false,
          outputFiles: [],
          error: `Code validation failed: ${validationError}`,
          outputType: plan.outputType
        }
      }

      // Execute in sandbox
      const result = await runPythonCode(
        runner.getPythonPath(),
        runner.getWrapperPath(),
        code,
        { rows, plan: { title: plan.title, outputType: plan.outputType } },
        { timeoutMs: 30_000 }
      )

      if (signal?.aborted) {
        return null
      }

      return {
        success: result.success,
        outputFiles: result.outputFiles,
        outputData: result.outputData,
        error: result.error,
        outputType: plan.outputType
      }
    } catch (error) {
      void error
      return {
        success: false,
        outputFiles: [],
        error: `Python execution error: ${String(error)}`,
        outputType: plan.outputType
      }
    }
  }
}
