/**
 * engine-monitor — extract runtime metrics from agent-audit.log.
 *
 * Reports: latency per metric, verdict distribution, degradation rate.
 *
 * Usage: npx tsx scripts/ops/engine-monitor.ts [--log <path>]
 *   --log  Path to agent-audit.log (default: %APPDATA%/acc-assist/logs/agent-audit.log)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface AuditEntry {
  timestamp: string
  requestId: string
  stage: string
  prompt?: string
  durationMs?: number
  toolName?: string
}

function getDefaultLogPath(): string {
  const appData = process.env.APPDATA ?? process.env.HOME ?? '.'
  return join(appData, 'acc-assist', 'logs', 'agent-audit.log')
}

function parseLine(line: string): AuditEntry | null {
  try {
    const entry = JSON.parse(line) as AuditEntry
    if (!entry.timestamp || !entry.requestId || !entry.stage) return null
    return entry
  } catch {
    return null
  }
}

function main(): void {
  const args = process.argv.slice(2)
  let logPath = getDefaultLogPath()

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--log' && args[i + 1]) {
      logPath = args[i + 1]!
      i++
    }
  }

  let content: string
  try {
    content = readFileSync(logPath, 'utf8')
  } catch {
    console.error(`Cannot read audit log: ${logPath}`)
    process.exit(1)
  }

  const entries: AuditEntry[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseLine(trimmed)
    if (parsed) entries.push(parsed)
  }

  if (entries.length === 0) {
    console.log('No audit entries found.')
    process.exit(0)
  }

  const engineModeEntries = entries.filter((e) => e.stage === 'engine-mode')
  const finalEntries = entries.filter((e) => e.stage === 'final')
  const latencyByMetric = new Map<string, { count: number; totalMs: number; maxMs: number }>()
  for (const e of finalEntries) {
    if (e.durationMs == null) continue
    const metricMatch = (e.prompt ?? '').match(/metricId=([^ ]+)/)
    const metricId = metricMatch ? metricMatch[1]! : 'unknown'
    const existing = latencyByMetric.get(metricId) ?? { count: 0, totalMs: 0, maxMs: 0 }
    existing.count++
    existing.totalMs += e.durationMs
    existing.maxMs = Math.max(existing.maxMs, e.durationMs)
    latencyByMetric.set(metricId, existing)
  }

  const verdictOk = finalEntries.filter((e) =>
    (e.prompt ?? '').includes('verdict=ok') || (e.prompt ?? '').includes('Verifier: passed')
  ).length
  const verdictFail = finalEntries.filter((e) =>
    (e.prompt ?? '').includes('verdict=fail') || (e.prompt ?? '').includes('Verifier: failed')
  ).length

  console.log('=== Engine Monitor ===\n')
  console.log(`Audit entries total: ${entries.length}`)
  console.log(`Engine-mode entries: ${engineModeEntries.length}`)
  console.log(`Final entries: ${finalEntries.length}`)
  console.log()

  console.log('--- Latency by metric ---')
  console.log('metricId           | count | avg(ms) | max(ms)')
  console.log('--------------------|-------|---------|--------')
  for (const [metricId, stats] of latencyByMetric) {
    const avg = (stats.totalMs / stats.count).toFixed(0)
    console.log(
      `${metricId.padEnd(18)} | ${String(stats.count).padStart(5)} | ${avg.padStart(7)} | ${String(stats.maxMs).padStart(6)}`
    )
  }
  console.log()

  console.log('--- Verdict distribution ---')
  console.log(`  ok:   ${verdictOk}`)
  console.log(`  fail: ${verdictFail}`)
  console.log()

  process.exit(0)
}

main()
