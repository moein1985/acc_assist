/**
 * regressionCorpusEval — regression corpus evaluator.
 *
 * Runs every case in scripts/fixtures/regression-corpus.json through the
 * router + checkIntentAlignment pipeline and reports pass/fail.
 *
 * Usage:
 *   npx tsx scripts/ops/regressionCorpusEval.ts
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { routeMetric, routeMultiMetric, routeDerivedMetric } from '../../src/main/services/financialEngine/router'
import { checkIntentAlignment } from '../../src/main/services/financialEngine/verifier'
import { isFinancialNumericQuery } from '../../src/main/services/agentOrchestrator/routing'
import type { MetricPlan } from '../../src/main/services/financialEngine/types'

interface CorpusCase {
  prompt: string
  expectedMetricId: string | null
  expectedBehavior: 'answer' | 'clarify' | 'refuse'
  source?: string
  category?: string
  rootCluster?: string
  notes?: string
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusPath = resolve(__dirname, '../fixtures/regression-corpus.json')
const corpus: CorpusCase[] = JSON.parse(readFileSync(corpusPath, 'utf-8'))

let passCount = 0
let failCount = 0
const failures: Array<{ case: CorpusCase; reason: string; routedTo: string | null }> = []

for (const tc of corpus) {
  // Step 0: Check if this is a financial numeric query at all
  const isFinancial = isFinancialNumericQuery(tc.prompt)
  if (!isFinancial) {
    // Text-guidance path — engine never sees it
    if (tc.expectedBehavior === 'refuse' || tc.expectedBehavior === 'clarify') {
      passCount++
    } else {
      failCount++
      failures.push({ case: tc, reason: 'expected answer but isFinancialNumericQuery=false (text-guidance path)', routedTo: null })
    }
    continue
  }

  // Step 1: Route the prompt
  const route = routeMetric(tc.prompt)
  const derivedRoute = routeDerivedMetric(tc.prompt)
  const multiRoute = routeMultiMetric(tc.prompt)

  const routedMetricId = derivedRoute?.id ?? route.metricId ?? multiRoute?.metricIds?.[0] ?? null

  // Step 2: Check intent alignment (simulating what agentOrchestrator does)
  let intentPassed = true
  let intentReason = ''
  if (routedMetricId) {
    const fakePlan: MetricPlan = {
      metricId: routedMetricId as any,
      grain: 'total' as any,
      filters: [],
      dateRange: { start: '', end: '' },
      confidence: route.confidence,
    }
    const intentCheck = checkIntentAlignment(tc.prompt, fakePlan)
    intentPassed = intentCheck.passed
    intentReason = intentCheck.reason ?? ''
  }

  // Step 3: Determine actual behavior
  let actualBehavior: 'answer' | 'clarify' | 'refuse'
  let actualMetricId: string | null = null

  if (!routedMetricId || !intentPassed) {
    actualBehavior = 'refuse'
  } else {
    actualMetricId = routedMetricId
    actualBehavior = 'answer'
  }

  // Step 4: Compare with expected
  let passed = false
  let reason = ''

  if (tc.expectedBehavior === 'answer') {
    if (actualBehavior === 'answer' && actualMetricId === tc.expectedMetricId) {
      passed = true
    } else if (actualBehavior === 'answer' && actualMetricId !== tc.expectedMetricId) {
      passed = false
      reason = `routed to ${actualMetricId} but expected ${tc.expectedMetricId}`
    } else {
      passed = false
      reason = `expected answer but got ${actualBehavior} (${intentReason || 'no route'})`
    }
  } else if (tc.expectedBehavior === 'refuse') {
    if (actualBehavior === 'refuse') {
      passed = true
    } else {
      passed = false
      reason = `expected refuse but got answer (${actualMetricId})`
    }
  } else if (tc.expectedBehavior === 'clarify') {
    // For now, clarify is treated as refuse in the router layer
    // (clarification happens at planner level, not router)
    if (actualBehavior === 'refuse') {
      passed = true
    } else {
      passed = false
      reason = `expected clarify/refuse but got answer (${actualMetricId})`
    }
  }

  if (passed) {
    passCount++
  } else {
    failCount++
    failures.push({ case: tc, reason, routedTo: routedMetricId })
  }
}

// Report
console.log('\n═══════════════════════════════════════════════════════════════')
console.log('  REGRESSION CORPUS EVALUATION')
console.log('═══════════════════════════════════════════════════════════════')
console.log(`  Total: ${corpus.length} | Pass: ${passCount} | Fail: ${failCount}`)
console.log(`  Pass rate: ${(passCount / corpus.length * 100).toFixed(1)}%`)
console.log('═══════════════════════════════════════════════════════════════\n')

if (failures.length > 0) {
  console.log('FAILURES:\n')
  for (const f of failures) {
    const cat = f.case.category ?? '?'
    const cluster = f.case.rootCluster ?? '?'
    console.log(`  [${cat}] "${f.case.prompt}"`)
    console.log(`    Reason: ${f.reason}`)
    console.log(`    Routed to: ${f.routedTo ?? 'null'}`)
    console.log(`    Expected: ${f.case.expectedBehavior} → ${f.case.expectedMetricId ?? 'null'}`)
    console.log(`    Cluster: ${cluster}`)
    if (f.case.notes) console.log(`    Notes: ${f.case.notes}`)
    console.log()
  }
}

// Cluster analysis
console.log('CLUSTER ANALYSIS:\n')
const clusterMap = new Map<string, { total: number; pass: number; fail: number }>()
for (const tc of corpus) {
  const cluster = tc.rootCluster ?? 'unknown'
  if (!clusterMap.has(cluster)) clusterMap.set(cluster, { total: 0, pass: 0, fail: 0 })
  const entry = clusterMap.get(cluster)!
  entry.total++
}
for (const f of failures) {
  const cluster = f.case.rootCluster ?? 'unknown'
  const entry = clusterMap.get(cluster)!
  entry.fail++
}
for (const [cluster, stats] of clusterMap) {
  stats.pass = stats.total - stats.fail
  const rate = (stats.pass / stats.total * 100).toFixed(0)
  console.log(`  ${cluster}: ${stats.pass}/${stats.total} (${rate}%) — ${stats.fail} failing`)
}

console.log()
process.exit(failCount > 0 ? 1 : 0)
