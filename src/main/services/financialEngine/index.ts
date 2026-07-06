/**
 * FinancialEngine — orchestrates the plan → compile → exec → verify → explain pipeline.
 *
 * Phase 1: no-op stub. None of these methods are called yet.
 * Phase 2+ will wire the actual pipeline.
 *
 * @see FRE_ROADMAP_00_OVERVIEW.fa.md
 */

import type {
  EngineResult,
  EngineVerdict,
  MetricPlan,
  MultiMetricPlan,
  MultiStepPlan,
  DerivedMetric,
  MetricId,
  MetricDefinition,
  PythonOutputPlan
} from './types'
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
  type PlannerConversationContext,
  type ClarifyResult,
  type RetryHint
} from './planner'
import { findMetricById } from './metricCatalog'
import { compileMetricPlan, type CompilerDeps } from './compiler'
import { verifyResult } from './verifier'
import { evaluateResult } from './resultEvaluator'
import { resolvePartyByName, buildPartyClarifyMessage } from './resolvePartyByName'
import {
  shouldInvestigate,
  investigate,
  DEFAULT_BUDGET,
  SchemaCache,
  type InvestigatorDeps,
} from './investigator'

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
  pythonOutput?: PythonOutputResult | null
}

export interface MultiStepResult {
  results: EngineResult[]
  verdicts: EngineVerdict[]
  plan: MultiStepPlan
  pythonOutput?: PythonOutputResult | null
}

export type EngineRunOutcome = EngineRunResult | MultiMetricResult | MultiStepResult

export class FinancialEngine {
  private schemaCache: SchemaCache = new SchemaCache()

  constructor(private deps: EngineDeps) {}

  async run(
    prompt: string,
    signal?: AbortSignal,
    lastPlan?: MetricPlan | null,
    pythonPlan?: PythonOutputPlan | null,
    conversationContext?: PlannerConversationContext
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

    // S22.3: Fast path ONLY at confidence 1.0 (very specific anchor match)
    if (route.metricId && route.confidence >= 1.0) {
      const plan = buildDeterministicPlan(prompt, route.metricId)
      if (plan) {
        const outcome = await this.runPlan(plan, signal, pythonPlan)
        // S22.7: Evaluate result — if not acceptable, fall through to retry loop
        const rows = (outcome as EngineRunResult).result?.rows ?? []
        const evaluation = evaluateResult(prompt, route.metricId, rows, plan)
        if (evaluation.acceptable) {
          return outcome
        }
      }
    }

    // S22.9: Agentic retry loop
    const MAX_RETRIES = 2
    const triedMetrics = new Set<string>()
    if (route.metricId) triedMetrics.add(route.metricId)

    let lastFailedMetric = ''
    let lastFailReason = ''

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (!this.deps.plannerModel) break

      const retryHint: RetryHint | undefined = attempt > 0 && (lastFailedMetric || lastFailReason)
        ? { failedMetricId: lastFailedMetric, reason: lastFailReason }
        : undefined

      const modelResult = await buildModelPlan(
        prompt,
        this.deps.plannerModel,
        this.deps.softwareId,
        conversationContext,
        retryHint
      )

      // MultiStepPlan from model
      if (modelResult.stepPlan && modelResult.stepPlan.confidence >= PLANNER_CONFIDENCE_THRESHOLD) {
        const stepPython = modelResult.stepPlan.steps.find(s => s.pythonOutput)?.pythonOutput ?? pythonPlan
        return this.runMultiStep(modelResult.stepPlan, signal, stepPython ?? null)
      }

      // MultiMetricPlan from model
      if (modelResult.multiPlan && modelResult.multiPlan.confidence >= PLANNER_CONFIDENCE_THRESHOLD) {
        const multiPython = modelResult.multiPlan.plans.find(p => p.pythonOutput)?.pythonOutput ?? pythonPlan
        return this.runMultiMetric(modelResult.multiPlan, signal, multiPython ?? null)
      }

      if (modelResult.plan && modelResult.plan.confidence >= PLANNER_CONFIDENCE_THRESHOLD) {
        if (triedMetrics.has(modelResult.plan.metricId)) {
          continue
        }
        triedMetrics.add(modelResult.plan.metricId)

        const planPython = modelResult.plan.pythonOutput ?? pythonPlan
        const outcome = await this.runPlan(modelResult.plan, signal, planPython ?? null)

        // S22.7: Evaluate result
        const rows = (outcome as EngineRunResult).result?.rows ?? []
        const evaluation = evaluateResult(prompt, modelResult.plan.metricId, rows, modelResult.plan)
        if (evaluation.acceptable) {
          return outcome
        }

        lastFailedMetric = modelResult.plan.metricId
        lastFailReason = evaluation.reason
        continue
      }

      // Low confidence or invalid plan → clarify
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

      // S38.9: Parse error → retry with corrective hint instead of immediate degrade
      if (modelResult.error) {
        const isParseError = modelResult.error === 'no-valid-json' || modelResult.error === 'json-parse-failed'
        if (isParseError && attempt < MAX_RETRIES - 1) {
          lastFailedMetric = ''
          lastFailReason = `planner output parse failed: ${modelResult.error}`
          continue
        }
        return {
          verdict: {
            ok: false,
            reason: `planner-error: ${modelResult.error}`,
            reconciliations: []
          },
          result: null
        }
      }

      break
    }

    // S22.3: Fallback to router candidate if planner couldn't find better
    if (route.metricId && route.confidence >= 0.5) {
      const plan = buildDeterministicPlan(prompt, route.metricId)
      if (plan) {
        return this.runPlan(plan, signal, pythonPlan)
      }
    }

    // S26.1: No metric match → check if investigation is warranted
    const metricMatched = !!route.metricId
    if (shouldInvestigate(prompt, metricMatched, false)) {
      const investigatorDeps: InvestigatorDeps = {
        executeReadOnlySql: (q, s) => this.deps.executeReadOnlySql(q, s),
        normalizePersianText: this.deps.normalizePersianText,
      }
      const investigation = await investigate(
        prompt,
        investigatorDeps,
        signal,
        DEFAULT_BUDGET,
        this.schemaCache
      )

      if (investigation.kind === 'answer' && investigation.clusters.length > 0) {
        const cluster = investigation.clusters[0]!
        const result: EngineResult = {
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
            sql: `-- investigator: ${investigation.queryBudgetUsed} queries, ${investigation.evidence.length} evidence entries`,
            bindingsDescription: 'investigator loop result',
          },
        }
        return {
          verdict: { ok: true, reason: undefined, reconciliations: [] },
          result,
        }
      } else if (investigation.kind === 'clarify') {
        return {
          verdict: {
            ok: false,
            reason: investigation.message,
            reconciliations: [],
          },
          result: null,
        }
      } else if (investigation.kind === 'refuse') {
        return {
          verdict: {
            ok: false,
            reason: investigation.reason,
            reconciliations: [],
          },
          result: null,
        }
      }
    }

    // Step 4: No metric match → degrade
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
    let pythonOutput: PythonOutputResult | null = null

    for (const subPlan of plan.plans) {
      const runResult = await this.runPlan(subPlan, signal, pythonPlan)
      if (runResult.result) {
        results.push(runResult.result)
      }
      if (runResult.pythonOutput) {
        pythonOutput = runResult.pythonOutput
      }
      verdicts.push(runResult.verdict)
    }

    return { results, verdicts, plan, pythonOutput }
  }

  // S20.3 — Run MultiStepPlan with cascade/compare/explain strategies
  async runMultiStep(
    plan: MultiStepPlan,
    signal?: AbortSignal,
    pythonPlan?: PythonOutputPlan | null
  ): Promise<MultiStepResult> {
    const results: EngineResult[] = []
    const verdicts: EngineVerdict[] = []
    let lastPythonOutput: PythonOutputResult | null = null
    const strategy = plan.combineStrategy ?? 'compare'
    const STEP_TIMEOUT_MS = 60_000
    const stepController = new AbortController()
    const stepTimeoutId = setTimeout(() => stepController.abort(), STEP_TIMEOUT_MS)

    const combinedSignal = signal
      ? AbortSignal.any([signal, stepController.signal])
      : stepController.signal

    try {
      if (strategy === 'cascade') {
        // cascade: output of step N becomes filter for step N+1
        let cascadeEntity: string | undefined
        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i]!
          const adjustedPlan: MetricPlan = {
            ...step,
            entityName: cascadeEntity ?? step.entityName
          }
          const runResult = await this.runPlan(adjustedPlan, combinedSignal, i === plan.steps.length - 1 ? pythonPlan : null)
          if (runResult.result) {
            results.push(runResult.result)
            if (runResult.pythonOutput) {
              lastPythonOutput = runResult.pythonOutput
            }
            // Extract entity name from first row for next step
            if (i === 0 && runResult.result.rows.length > 0) {
              const row = runResult.result.rows[0]!
              cascadeEntity = (row['entity_name'] ?? row['party_name'] ?? row['customer_name']) as string | undefined
            }
          }
          verdicts.push(runResult.verdict)
          if (!runResult.verdict.ok) break
        }
      } else {
        // compare & explain: each step runs independently
        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i]!
          const runResult = await this.runPlan(step, combinedSignal, i === plan.steps.length - 1 ? pythonPlan : null)
          if (runResult.result) {
            results.push(runResult.result)
          }
          if (runResult.pythonOutput) {
            lastPythonOutput = runResult.pythonOutput
          }
          verdicts.push(runResult.verdict)
        }
      }

      return { results, verdicts, plan, pythonOutput: lastPythonOutput }
    } catch (error) {
      void error
      return {
        results,
        verdicts: [...verdicts, { ok: false, reason: 'multistep-execution-error', reconciliations: [] }],
        plan
      }
    } finally {
      clearTimeout(stepTimeoutId)
    }
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
      // S25.9: Resolve party name to exact PartyId before compilation
      // Only for metrics where entityNameMatch targets p.Name (party), not a.Title (account)
      if (plan.entityName && def.entityNameMatch && def.entityNameMatch.column === 'p.Name' && plan.resolvedPartyId == null) {
        try {
          const resolveResult = await resolvePartyByName(plan.entityName, {
            executeReadOnlySql: (q, s) => this.deps.executeReadOnlySql(q, s),
            normalizePersianText: this.deps.normalizePersianText
          }, combinedSignal)

          if (resolveResult.kind === 'one') {
            plan = { ...plan, resolvedPartyId: resolveResult.candidate.partyId }
          } else if (resolveResult.kind === 'many') {
            return {
              verdict: {
                ok: false,
                reason: buildPartyClarifyMessage(resolveResult.candidates, resolveResult.queryName),
                reconciliations: []
              },
              result: null
            }
          }
          // kind === 'zero': fall through with no resolvedPartyId; compiler will use LIKE fallback
        } catch {
          // S38.10: If party resolution fails (SQL error), fall through to LIKE fallback
        }
      }

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

      const isListMetric = def.measure.kind === 'list'
      if (rows.length === 0 || (!isListMetric && rows.length === 1 && !rows[0]['result_value'])) {
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

      // S23.3: Fail-closed — if verdict is not ok, never return the result to any caller.
      // The caller (orchestrator) checks verdict.ok, but the engine itself must guarantee
      // that a rejected number never reaches the Explainer.
      if (!finalVerdict.ok) {
        // S26: Investigator loop — when metric matched but returned zero rows,
        // try to discover the answer via schema exploration before refusing.
        const rowsEmpty = rows.length === 0 || (!isListMetric && rows.length === 1 && !rows[0]['result_value'])
        if (shouldInvestigate(plan.entityName ?? plan.metricId, true, rowsEmpty)) {
          const investigatorDeps: InvestigatorDeps = {
            executeReadOnlySql: (q, s) => this.deps.executeReadOnlySql(q, s),
            normalizePersianText: this.deps.normalizePersianText,
          }
          const investigation = await investigate(
            plan.entityName ?? plan.metricId,
            investigatorDeps,
            combinedSignal,
            DEFAULT_BUDGET,
            this.schemaCache
          )

          if (investigation.kind === 'answer' && investigation.clusters.length > 0) {
            const cluster = investigation.clusters[0]!
            return {
              verdict: { ok: true, reason: undefined, reconciliations: [] },
              result: {
                rows: [{
                  result_value: cluster.netBalance,
                  account_title: cluster.accountTitle,
                  account_code: cluster.accountCode,
                  total_debit: cluster.totalDebit,
                  total_credit: cluster.totalCredit,
                  voucher_count: cluster.voucherCount,
                  partner_title: cluster.partnerTitle ?? '',
                }],
                plan,
                compiled,
              },
              pythonOutput: null,
            }
          } else if (investigation.kind === 'clarify') {
            return {
              verdict: { ok: false, reason: investigation.message, reconciliations: [] },
              result: null,
              pythonOutput: null,
            }
          }
        }

        return { verdict: finalVerdict, result: null, pythonOutput: null }
      }

      // S18.10: If PythonOutputPlan is enabled, run Python sandbox on the results
      let pythonOutput: PythonOutputResult | null = null
      if (pythonPlan && pythonPlan.enabled && finalVerdict.ok) {
        pythonOutput = await this.runPythonOutput(pythonPlan, plan.metricId, rows, signal)
      }

      return { verdict: finalVerdict, result: finalResult, pythonOutput: pythonOutput }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      return {
        verdict: { ok: false, reason: `execution-error: ${errMsg}`, reconciliations: [] },
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
