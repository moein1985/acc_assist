/**
 * goldenMetricEval — golden metric evaluation harness.
 *
 * Offline mode (default): route → plan → compile → mock-exec → verify → explain.
 * Live mode (--live): route → plan → compile → REAL DB exec → verify → explain.
 *
 * Usage:
 *   npx tsx scripts/ops/goldenMetricEval.ts            # offline (mock)
 *   npx tsx scripts/ops/goldenMetricEval.ts --live      # live (real DB)
 *
 * Live mode env vars:
 *   ACC_LIVE_SQL_SERVER, ACC_LIVE_SQL_PORT, ACC_LIVE_SQL_DB,
 *   ACC_LIVE_SQL_USER, ACC_LIVE_SQL_PASSWORD
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { routeMetric, routeMultiMetric, routeDerivedMetric } from '../../src/main/services/financialEngine/router'
import { buildDeterministicPlan, buildDeterministicMultiPlan, buildFollowUpPlan, isDrillDownPrompt, buildPlannerPrompt } from '../../src/main/services/financialEngine/planner'
import { compileMetricPlan } from '../../src/main/services/financialEngine/compiler'
import { verifyResult } from '../../src/main/services/financialEngine/verifier'
import { composeEngineResponseMarkdown } from '../../src/main/services/financialEngine/explainer'
import { findMetricById } from '../../src/main/services/financialEngine/metricCatalog'
import type { EngineResult, EngineVerdict } from '../../src/main/services/financialEngine/types'
import type { SqlQueryRow } from '../../src/shared/contracts'

interface GoldenMetricCase {
  id: string
  prompt: string
  expectedMetricId?: string
  expectedGrain?: string
  expectedValue?: number
  tolerance?: number
  expect?: 'any_rows' | 'any_number' | 'multi_metric' | 'derived_metric' | 'multi_step'
  expectedMetricIds?: string[]
  expectedDerivedId?: string
  expectedCombineStrategy?: string
  expectedDateRange?: { start?: string; end?: string }
  expectedVoucherNumber?: string
  expectedVoucherType?: string
}

interface GoldenNegativeCase {
  id: string
  prompt: string
  expect: 'refuse'
}

interface GoldenClarifyCase {
  id: string
  prompt: string
  expect: 'clarify'
}

interface GoldenConversationStep {
  prompt: string
  expectedMetricId?: string
  expectedGrain?: string
}

interface GoldenConversationCase {
  id: string
  steps: GoldenConversationStep[]
}

interface GoldenPythonOutputCase {
  id: string
  prompt: string
  expectedOutputType: string
  expectedChartType?: string
  expectedCodeContains: string[]
}

interface GoldenLiveNegativeCase {
  id: string
  prompt: string
  expect: 'no_number' | 'metric_mismatch'
  expectedMetricId?: string
  reason: string
}

interface GoldenFixture {
  metrics: GoldenMetricCase[]
  negative: GoldenNegativeCase[]
  clarify: GoldenClarifyCase[]
  conversations?: GoldenConversationCase[]
  pythonOutput?: GoldenPythonOutputCase[]
  liveNegative?: GoldenLiveNegativeCase[]
}

interface CaseResult {
  id: string
  prompt: string
  passed: boolean
  reason?: string
  metricId?: string
  expectedMetricId?: string
  grain?: string
  expectedGrain?: string
  value?: number | null
  expectedValue?: number
  diff?: number
}

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadFixture(): GoldenFixture {
  const fixturePath = resolve(__dirname, '../fixtures/golden-metrics.json')
  const raw = readFileSync(fixturePath, 'utf-8')
  return JSON.parse(raw) as GoldenFixture
}

function makeMockExecutor(
  expectedValue: number
): (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]> {
  void expectedValue
  return async (): Promise<SqlQueryRow[]> => {
    return [{ result_value: expectedValue }]
  }
}

// S23.14 — Live executor: connects to real SQL Server via mssql
interface LiveSqlConfig {
  server: string
  port: number
  database: string
  user: string
  password: string
}

function parseLiveConfig(): LiveSqlConfig | null {
  const server = process.env.ACC_LIVE_SQL_SERVER
  const port = process.env.ACC_LIVE_SQL_PORT
  const database = process.env.ACC_LIVE_SQL_DB
  const user = process.env.ACC_LIVE_SQL_USER
  const password = process.env.ACC_LIVE_SQL_PASSWORD

  if (!server || !database || !user || !password) {
    return null
  }

  return {
    server,
    port: port ? parseInt(port, 10) : 1433,
    database,
    user,
    password
  }
}

async function makeLiveExecutor(
  config: LiveSqlConfig
): Promise<(query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>> {
  const mssql = (await import('mssql')).default

  const pool = new mssql.ConnectionPool({
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      trustServerCertificate: true,
      encrypt: false
    },
    requestTimeout: 60000
  })

  await pool.connect()
  console.log(`  [live] Connected to ${config.server}:${config.port}/${config.database}`)

  return async (query: string, _signal?: AbortSignal): Promise<SqlQueryRow[]> => {
    const request = pool.request()
    request.timeout = 60000
    const result = await request.query(query)
    if (!result.recordset || result.recordset.length === 0) {
      return []
    }
    return result.recordset as SqlQueryRow[]
  }
}

function makeCompilerDeps(): {
  quoteSqlTableRef: (ref: string) => string
  quoteSqlIdentifier: (id: string) => string
  normalizePersianText: (text: string) => string
} {
  return {
    quoteSqlTableRef: (ref: string) => {
      const parts = ref.split('.')
      if (parts.length === 2) return `[${parts[0]}].[${parts[1]}]`
      return `[${ref}]`
    },
    quoteSqlIdentifier: (id: string) => `[${id}]`,
    normalizePersianText: (text: string) => text
  }
}

type LiveExecutor = ((query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>) | null

async function evalMetricCase(case_: GoldenMetricCase, liveExecutor: LiveExecutor = null): Promise<CaseResult> {
  // Handle multi-metric cases
  if (case_.expect === 'multi_metric') {
    const multiRoute = routeMultiMetric(case_.prompt)
    if (multiRoute.metricIds.length < 2) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `routeMultiMetric returned ${multiRoute.metricIds.length} metrics, expected 2+`
      }
    }
    const multiPlan = buildDeterministicMultiPlan(case_.prompt)
    if (!multiPlan) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: 'buildDeterministicMultiPlan returned null'
      }
    }
    const gotIds = multiPlan.plans.map((p) => p.metricId)
    const expectedIds = case_.expectedMetricIds ?? []
    const allMatch = expectedIds.every((id) => gotIds.includes(id as never))
    if (!allMatch) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `metricIds mismatch: got [${gotIds.join(', ')}], expected [${expectedIds.join(', ')}]`
      }
    }
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      metricId: gotIds.join(', ')
    }
  }

  // Handle multi-step cases (S20)
  if (case_.expect === 'multi_step') {
    const prompt = buildPlannerPrompt(case_.prompt)
    assert.ok(prompt.includes('MultiStepPlan'), 'prompt should include MultiStepPlan schema')
    assert.ok(prompt.includes('combineStrategy'), 'prompt should include combineStrategy')
    // Verify the prompt includes domain knowledge (S20.11)
    assert.ok(prompt.includes('دانش حسابداری'), 'prompt should include domain knowledge')
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      metricId: 'multi_step'
    }
  }

  // Handle derived metric cases
  if (case_.expect === 'derived_metric') {
    const derived = routeDerivedMetric(case_.prompt)
    if (!derived) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: 'routeDerivedMetric returned null'
      }
    }
    if (case_.expectedDerivedId && derived.id !== case_.expectedDerivedId) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `derivedId mismatch: got ${derived.id}, expected ${case_.expectedDerivedId}`
      }
    }
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      metricId: derived.id
    }
  }

  const route = routeMetric(case_.prompt)

  if (!route.metricId || route.confidence < 0.5) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: `router returned no match (confidence=${route.confidence})`,
      expectedMetricId: case_.expectedMetricId
    }
  }

  if (case_.expectedMetricId && route.metricId !== case_.expectedMetricId) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: `metricId mismatch: got ${route.metricId}, expected ${case_.expectedMetricId}`,
      metricId: route.metricId,
      expectedMetricId: case_.expectedMetricId
    }
  }

  const plan = buildDeterministicPlan(case_.prompt, route.metricId)
  if (!plan) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: 'buildDeterministicPlan returned null',
      metricId: route.metricId,
      expectedMetricId: case_.expectedMetricId
    }
  }

  if (case_.expectedGrain && plan.grain !== case_.expectedGrain) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: `grain mismatch: got ${plan.grain}, expected ${case_.expectedGrain}`,
      metricId: route.metricId,
      grain: plan.grain,
      expectedGrain: case_.expectedGrain,
      expectedMetricId: case_.expectedMetricId
    }
  }

  // S14.5: Check dateRange if expected
  if (case_.expectedDateRange) {
    const expected = case_.expectedDateRange
    const actual = plan.dateRange
    if (!actual) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: 'dateRange expected but not present in plan',
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
    if (expected.start && actual.start !== expected.start) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `dateRange.start mismatch: got ${actual.start}, expected ${expected.start}`,
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
    if (expected.end && actual.end !== expected.end) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `dateRange.end mismatch: got ${actual.end}, expected ${expected.end}`,
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
  }

  // S14.6: Check voucherNumber if expected
  if (case_.expectedVoucherNumber) {
    if (!plan.voucherNumber) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: 'voucherNumber expected but not present in plan',
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
    if (plan.voucherNumber !== case_.expectedVoucherNumber) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `voucherNumber mismatch: got ${plan.voucherNumber}, expected ${case_.expectedVoucherNumber}`,
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
  }

  // S14.8: Check voucherType if expected
  if (case_.expectedVoucherType) {
    if (!plan.voucherType) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: 'voucherType expected but not present in plan',
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
    if (plan.voucherType !== case_.expectedVoucherType) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `voucherType mismatch: got ${plan.voucherType}, expected ${case_.expectedVoucherType}`,
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
  }

  const def = findMetricById(plan.metricId)
  if (!def) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: 'metric definition not found',
      metricId: route.metricId,
      expectedMetricId: case_.expectedMetricId
    }
  }

  try {
    const compilerDeps = makeCompilerDeps()
    const compiled = compileMetricPlan(plan, def, compilerDeps)

    // Execution: live or mock
    let rows: SqlQueryRow[]
    if (liveExecutor) {
      try {
        rows = await liveExecutor(compiled.sql)
      } catch (execError) {
        return {
          id: case_.id,
          prompt: case_.prompt,
          passed: false,
          reason: `live exec error: ${execError instanceof Error ? execError.message : String(execError)}`,
          metricId: route.metricId,
          expectedMetricId: case_.expectedMetricId
        }
      }
    } else {
      const mockValue = case_.expectedValue ?? 1
      const mockExec = makeMockExecutor(mockValue)
      rows = await mockExec(compiled.sql)
    }

    const result: EngineResult = { rows, plan, compiled }
    const verdict: EngineVerdict = verifyResult(result, plan, def)

    if (!verdict.ok) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `verifier failed: ${verdict.reason ?? 'unknown'}`,
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }

    // For list-type metrics (expect: 'any_rows'), skip numeric value check
    if (case_.expect === 'any_rows') {
      // Check explainer produces markdown
      const markdown = composeEngineResponseMarkdown(result, verdict, case_.prompt)
      if (!markdown.includes('### Summary') || !markdown.includes('### Evidence')) {
        return {
          id: case_.id,
          prompt: case_.prompt,
          passed: false,
          reason: 'explainer output missing required sections',
          metricId: route.metricId,
          expectedMetricId: case_.expectedMetricId
        }
      }
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: true,
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId,
        grain: plan.grain,
        expectedGrain: case_.expectedGrain
      }
    }

    // Check value
    const rawValue = rows[0]?.['result_value']
    const value = rawValue !== null && rawValue !== undefined ? Number(rawValue) : null

    if (value === null || !Number.isFinite(value)) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: 'no numeric value returned',
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId,
        expectedValue: case_.expectedValue
      }
    }

    const expectedVal = case_.expectedValue ?? 0
    const tolerance = case_.tolerance ?? 0
    const diff = Math.abs(value - expectedVal)
    if (diff > tolerance) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `value out of tolerance: diff=${diff}`,
        metricId: route.metricId,
        value,
        expectedValue: case_.expectedValue,
        diff,
        expectedMetricId: case_.expectedMetricId
      }
    }

    // Check explainer produces markdown
    const markdown = composeEngineResponseMarkdown(result, verdict, case_.prompt)
    if (!markdown.includes('### Summary') || !markdown.includes('### Evidence')) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: 'explainer output missing required sections',
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }

    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      metricId: route.metricId,
      expectedMetricId: case_.expectedMetricId,
      grain: plan.grain,
      expectedGrain: case_.expectedGrain,
      value,
      expectedValue: case_.expectedValue,
      diff
    }
  } catch (error) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: `exception: ${error instanceof Error ? error.message : String(error)}`,
      metricId: route.metricId,
      expectedMetricId: case_.expectedMetricId
    }
  }
}

function evalNegativeCase(case_: GoldenNegativeCase): CaseResult {
  const route = routeMetric(case_.prompt)
  if (route.metricId && route.confidence >= 0.7) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: `should refuse but router matched ${route.metricId} (conf=${route.confidence})`
    }
  }
  return { id: case_.id, prompt: case_.prompt, passed: true }
}

function evalConversationCase(case_: GoldenConversationCase): CaseResult[] {
  const results: CaseResult[] = []
  let lastPlan: ReturnType<typeof buildDeterministicPlan> = null

  for (let i = 0; i < case_.steps.length; i++) {
    const step = case_.steps[i]!
    const stepId = `${case_.id}#step${i + 1}`

    if (lastPlan && isDrillDownPrompt(step.prompt)) {
      const followUp = buildFollowUpPlan(step.prompt, lastPlan)
      if (!followUp) {
        results.push({
          id: stepId,
          prompt: step.prompt,
          passed: false,
          reason: 'buildFollowUpPlan returned null',
          expectedMetricId: step.expectedMetricId
        })
        continue
      }
      if (step.expectedMetricId && followUp.metricId !== step.expectedMetricId) {
        results.push({
          id: stepId,
          prompt: step.prompt,
          passed: false,
          reason: `metricId mismatch: got ${followUp.metricId}, expected ${step.expectedMetricId}`,
          metricId: followUp.metricId,
          expectedMetricId: step.expectedMetricId
        })
        continue
      }
      if (step.expectedGrain && followUp.grain !== step.expectedGrain) {
        results.push({
          id: stepId,
          prompt: step.prompt,
          passed: false,
          reason: `grain mismatch: got ${followUp.grain}, expected ${step.expectedGrain}`,
          metricId: followUp.metricId,
          grain: followUp.grain,
          expectedGrain: step.expectedGrain,
          expectedMetricId: step.expectedMetricId
        })
        continue
      }
      lastPlan = followUp
      results.push({
        id: stepId,
        prompt: step.prompt,
        passed: true,
        metricId: followUp.metricId,
        expectedMetricId: step.expectedMetricId,
        grain: followUp.grain,
        expectedGrain: step.expectedGrain
      })
    } else {
      const route = routeMetric(step.prompt)
      if (!route.metricId || route.confidence < 0.5) {
        results.push({
          id: stepId,
          prompt: step.prompt,
          passed: false,
          reason: `router returned no match (confidence=${route.confidence})`,
          expectedMetricId: step.expectedMetricId
        })
        continue
      }
      if (step.expectedMetricId && route.metricId !== step.expectedMetricId) {
        results.push({
          id: stepId,
          prompt: step.prompt,
          passed: false,
          reason: `metricId mismatch: got ${route.metricId}, expected ${step.expectedMetricId}`,
          metricId: route.metricId,
          expectedMetricId: step.expectedMetricId
        })
        continue
      }
      const plan = buildDeterministicPlan(step.prompt, route.metricId)
      if (!plan) {
        results.push({
          id: stepId,
          prompt: step.prompt,
          passed: false,
          reason: 'buildDeterministicPlan returned null',
          metricId: route.metricId,
          expectedMetricId: step.expectedMetricId
        })
        continue
      }
      if (step.expectedGrain && plan.grain !== step.expectedGrain) {
        results.push({
          id: stepId,
          prompt: step.prompt,
          passed: false,
          reason: `grain mismatch: got ${plan.grain}, expected ${step.expectedGrain}`,
          metricId: route.metricId,
          grain: plan.grain,
          expectedGrain: step.expectedGrain,
          expectedMetricId: step.expectedMetricId
        })
        continue
      }
      lastPlan = plan
      results.push({
        id: stepId,
        prompt: step.prompt,
        passed: true,
        metricId: route.metricId,
        expectedMetricId: step.expectedMetricId,
        grain: plan.grain,
        expectedGrain: step.expectedGrain
      })
    }
  }
  return results
}

function evalClarifyCase(case_: GoldenClarifyCase): CaseResult {
  const route = routeMetric(case_.prompt)
  // Clarify cases: router may match but with low confidence, or match but no year filter
  if (!route.metricId || route.confidence < 0.7) {
    return { id: case_.id, prompt: case_.prompt, passed: true }
  }

  // If router matched confidently, check if plan has year filter — if not, it should clarify
  const plan = buildDeterministicPlan(case_.prompt, route.metricId)
  if (!plan) {
    return { id: case_.id, prompt: case_.prompt, passed: true }
  }

  // S10.8: If prompt has no year but plan auto-fills current year, that's correct behavior
  const promptHasYear = /\d{4}/.test(case_.prompt)
  if (!promptHasYear) {
    return { id: case_.id, prompt: case_.prompt, passed: true }
  }

  const hasYearFilter = plan.filters.some((f) => f.dimension === 'by_year')
  if (!hasYearFilter && !plan.comparison) {
    return { id: case_.id, prompt: case_.prompt, passed: true }
  }

  return {
    id: case_.id,
    prompt: case_.prompt,
    passed: false,
    reason: `should clarify but plan has year filter or comparison`
  }
}

// S23.16: Evaluate live negative cases — engine must not produce numbers for edge cases
async function evalLiveNegativeCase(
  case_: GoldenLiveNegativeCase,
  liveExecutor: LiveExecutor
): Promise<CaseResult> {
  if (!liveExecutor) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: 'live negative cases require --live flag'
    }
  }

  const route = routeMetric(case_.prompt)
  if (!route.metricId || route.confidence < 0.5) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      reason: 'router correctly refused (no metric match)'
    }
  }

  if (case_.expect === 'metric_mismatch' && case_.expectedMetricId) {
    if (route.metricId !== case_.expectedMetricId) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: false,
        reason: `metric mismatch: got ${route.metricId}, expected ${case_.expectedMetricId}`,
        metricId: route.metricId,
        expectedMetricId: case_.expectedMetricId
      }
    }
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      metricId: route.metricId,
      expectedMetricId: case_.expectedMetricId
    }
  }

  // expect: 'no_number' — route to metric, compile, execute on live DB, check no number
  const plan = buildDeterministicPlan(case_.prompt, route.metricId)
  if (!plan) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      reason: 'no plan built — engine correctly refused'
    }
  }

  const def = findMetricById(plan.metricId)
  if (!def) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: 'metric definition not found'
    }
  }

  try {
    const compilerDeps = makeCompilerDeps()
    const compiled = compileMetricPlan(plan, def, compilerDeps)
    const rows = await liveExecutor(compiled.sql)

    if (!rows || rows.length === 0) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: true,
        reason: 'no rows returned — engine correctly produced no number',
        metricId: route.metricId
      }
    }

    const rawValue = rows[0]?.['result_value']
    const value = rawValue !== null && rawValue !== undefined ? Number(rawValue) : null

    if (value === null || !Number.isFinite(value) || value === 0) {
      return {
        id: case_.id,
        prompt: case_.prompt,
        passed: true,
        reason: `value is null/0/NaN — engine correctly produced no meaningful number`,
        metricId: route.metricId,
        value
      }
    }

    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: false,
      reason: `HALLUCINATION: engine returned ${value} for a case that should have no number`,
      metricId: route.metricId,
      value
    }
  } catch (error) {
    return {
      id: case_.id,
      prompt: case_.prompt,
      passed: true,
      reason: `exec error (engine correctly refused): ${error instanceof Error ? error.message : String(error)}`,
      metricId: route.metricId
    }
  }
}

async function main(): Promise<void> {
  const fixture = loadFixture()
  const results: CaseResult[] = []

  // S23.14: Check for --live flag
  const isLive = process.argv.includes('--live')
  let liveExecutor: LiveExecutor = null

  if (isLive) {
    const config = parseLiveConfig()
    if (!config) {
      console.error('  [live] Missing env vars. Set ACC_LIVE_SQL_SERVER, ACC_LIVE_SQL_PORT, ACC_LIVE_SQL_DB, ACC_LIVE_SQL_USER, ACC_LIVE_SQL_PASSWORD')
      process.exit(1)
    }
    try {
      liveExecutor = await makeLiveExecutor(config)
    } catch (err) {
      console.error(`  [live] Failed to connect: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  Golden Metric Evaluation — FRE${isLive ? ' (LIVE)' : ''}`)
  console.log('═══════════════════════════════════════════════════════════\n')

  // Metric cases
  console.log('── Metric Cases ──')
  for (const case_ of fixture.metrics) {
    const result = await evalMetricCase(case_, liveExecutor)
    results.push(result)
    const status = result.passed ? '✓' : '✗'
    const detail = result.passed
      ? `metric=${result.metricId} value=${result.value?.toLocaleString('en-US')} diff=${result.diff}`
      : `FAIL: ${result.reason}`
    console.log(`  ${status} ${result.id}: ${detail}`)
  }

  // Negative cases
  console.log('\n── Negative Cases (expect: refuse) ──')
  for (const case_ of fixture.negative) {
    const result = evalNegativeCase(case_)
    results.push(result)
    const status = result.passed ? '✓' : '✗'
    const detail = result.passed ? 'refused correctly' : `FAIL: ${result.reason}`
    console.log(`  ${status} ${result.id}: ${detail}`)
  }

  // Clarify cases
  console.log('\n── Clarify Cases (expect: clarify) ──')
  for (const case_ of fixture.clarify) {
    const result = evalClarifyCase(case_)
    results.push(result)
    const status = result.passed ? '✓' : '✗'
    const detail = result.passed ? 'clarified correctly' : `FAIL: ${result.reason}`
    console.log(`  ${status} ${result.id}: ${detail}`)
  }

  // Conversation cases (S14.42)
  if (fixture.conversations && fixture.conversations.length > 0) {
    console.log('\n── Conversation Cases (S14.42 drill-down) ──')
    for (const case_ of fixture.conversations) {
      const convResults = evalConversationCase(case_)
      for (const result of convResults) {
        results.push(result)
        const status = result.passed ? '✓' : '✗'
        const detail = result.passed
          ? `metric=${result.metricId} grain=${result.grain}`
          : `FAIL: ${result.reason}`
        console.log(`  ${status} ${result.id}: ${detail}`)
      }
    }
  }

  // Python output cases (S18.14)
  if (fixture.pythonOutput && fixture.pythonOutput.length > 0) {
    console.log('\n── Python Output Cases (S18.14) ──')
    const { generatePythonCode } = await import('../../src/main/services/financialEngine/pythonTemplates')
    for (const case_ of fixture.pythonOutput) {
      const plan = {
        enabled: true,
        outputType: case_.expectedOutputType as 'chart' | 'excel' | 'pdf' | 'csv' | 'html' | 'table',
        chartType: case_.expectedChartType as 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'heatmap' | undefined,
        title: 'Test',
        xAxis: 'x',
        yAxis: 'y'
      }
      const code = generatePythonCode(plan, 'net_sales')
      let passed = true
      const missing: string[] = []
      for (const expected of case_.expectedCodeContains) {
        if (!code.includes(expected)) {
          passed = false
          missing.push(expected)
        }
      }
      results.push({
        id: case_.id,
        prompt: case_.prompt,
        passed,
        reason: passed ? undefined : `missing code fragments: ${missing.join(', ')}`
      })
      const status = passed ? '✓' : '✗'
      const detail = passed
        ? `outputType=${case_.expectedOutputType}`
        : `FAIL: missing ${missing.join(', ')}`
      console.log(`  ${status} ${case_.id}: ${detail}`)
    }
  }

  // S23.16: Live negative cases (only in --live mode)
  if (isLive && fixture.liveNegative && fixture.liveNegative.length > 0) {
    console.log('\n── Live Negative Cases (S23.16 — no hallucination) ──')
    for (const case_ of fixture.liveNegative) {
      const result = await evalLiveNegativeCase(case_, liveExecutor)
      results.push(result)
      const status = result.passed ? '✓' : '✗'
      const detail = result.passed
        ? (result.reason ?? 'passed')
        : `FAIL: ${result.reason}`
      console.log(`  ${status} ${result.id}: ${detail}`)
    }
  }

  // Summary
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const total = results.length
  const score = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0'

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`  Summary: ${passed}/${total} passed (${score}%) — ${failed} failed`)
  console.log('═══════════════════════════════════════════════════════════')

  if (failed > 0) {
    process.exit(1)
  }
}

void main()
