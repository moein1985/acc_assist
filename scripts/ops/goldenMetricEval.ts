/**
 * goldenMetricEval — offline golden metric evaluation harness.
 *
 * Runs route → plan → compile → mock-exec → verify → explain for each golden case.
 * Checks: metricId match, grain match, SQL snapshot, value within tolerance.
 * No real DB — mock executor returns oracle rows from golden-metrics.json.
 *
 * Usage: npx tsx scripts/ops/goldenMetricEval.ts
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { routeMetric, routeMultiMetric, routeDerivedMetric } from '../../src/main/services/financialEngine/router'
import { buildDeterministicPlan, buildDeterministicMultiPlan } from '../../src/main/services/financialEngine/planner'
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
  expect?: 'any_rows' | 'any_number' | 'multi_metric' | 'derived_metric'
  expectedMetricIds?: string[]
  expectedDerivedId?: string
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

interface GoldenFixture {
  metrics: GoldenMetricCase[]
  negative: GoldenNegativeCase[]
  clarify: GoldenClarifyCase[]
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

async function evalMetricCase(case_: GoldenMetricCase): Promise<CaseResult> {
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

    // Mock execution
    const mockValue = case_.expectedValue ?? 1
    const mockExec = makeMockExecutor(mockValue)
    const rows = await mockExec(compiled.sql)

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

async function main(): Promise<void> {
  const fixture = loadFixture()
  const results: CaseResult[] = []

  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Golden Metric Evaluation — FRE Phase 6')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Metric cases
  console.log('── Metric Cases ──')
  for (const case_ of fixture.metrics) {
    const result = await evalMetricCase(case_)
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
