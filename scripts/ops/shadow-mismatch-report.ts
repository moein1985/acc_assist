/**
 * shadow-mismatch-report — parse agent-audit.log for engine-shadow-compare entries.
 *
 * Extracts shadow comparison lines, groups by metricId and date,
 * and prints a table of mismatches.
 *
 * Usage: npx tsx scripts/ops/shadow-mismatch-report.ts [--log <path>]
 *   --log  Path to agent-audit.log (default: %APPDATA%/acc-assist/logs/agent-audit.log)
 *
 * Exit code: 0 if no mismatches, 1 if any mismatches found.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface ShadowEntry {
  timestamp: string
  requestId: string
  metricId: string | null
  legacyValue: string | null
  engineValue: string | null
  match: boolean
  error?: string
}

function getDefaultLogPath(): string {
  const appData = process.env.APPDATA ?? process.env.HOME ?? '.'
  return join(appData, 'acc-assist', 'logs', 'agent-audit.log')
}

function parseLine(line: string): ShadowEntry | null {
  try {
    const entry = JSON.parse(line) as {
      timestamp: string
      requestId: string
      stage: string
      prompt?: string
    }

    if (entry.stage !== 'engine-shadow-compare') return null

    const prompt = entry.prompt ?? ''

    if (prompt.startsWith('error=')) {
      return {
        timestamp: entry.timestamp,
        requestId: entry.requestId,
        metricId: null,
        legacyValue: null,
        engineValue: null,
        match: false,
        error: prompt.slice('error='.length)
      }
    }

    const metricIdMatch = prompt.match(/metricId=([^ ]+)/)
    const legacyMatch = prompt.match(/legacyValue=([^ ]+)/)
    const engineMatch = prompt.match(/engineValue=([^ ]+)/)
    const matchMatch = prompt.match(/match=(true|false)/)

    return {
      timestamp: entry.timestamp,
      requestId: entry.requestId,
      metricId: metricIdMatch ? metricIdMatch[1]! : null,
      legacyValue: legacyMatch ? legacyMatch[1]! : null,
      engineValue: engineMatch ? engineMatch[1]! : null,
      match: matchMatch ? matchMatch[1] === 'true' : false
    }
  } catch {
    return null
  }
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toISOString().slice(0, 10)
  } catch {
    return 'unknown'
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

  const entries: ShadowEntry[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseLine(trimmed)
    if (parsed) entries.push(parsed)
  }

  if (entries.length === 0) {
    console.log('No engine-shadow-compare entries found.')
    process.exit(0)
  }

  const mismatches = entries.filter((e) => !e.match)
  const errors = entries.filter((e) => e.error)

  console.log('=== Shadow Mismatch Report ===\n')
  console.log(`Total comparisons: ${entries.length}`)
  console.log(`Matches: ${entries.length - mismatches.length}`)
  console.log(`Mismatches: ${mismatches.length}`)
  console.log(`Errors: ${errors.length}`)
  console.log()

  if (mismatches.length > 0) {
    console.log('--- Mismatches ---')
    console.log('date       | metricId           | legacyValue        | engineValue        | requestId')
    console.log('-----------|--------------------|--------------------|--------------------|----------')
    for (const m of mismatches) {
      const date = formatDate(m.timestamp)
      console.log(
        `${date} | ${(m.metricId ?? 'null').padEnd(18)} | ${(m.legacyValue ?? 'null').padEnd(18)} | ${(m.engineValue ?? 'null').padEnd(18)} | ${m.requestId}`
      )
    }
    console.log()
  }

  if (errors.length > 0) {
    console.log('--- Errors ---')
    for (const e of errors) {
      console.log(`[${e.timestamp}] ${e.requestId}: ${e.error}`)
    }
    console.log()
  }

  const byMetric = new Map<string, { total: number; mismatch: number }>()
  for (const e of entries) {
    const key = e.metricId ?? 'null'
    const existing = byMetric.get(key) ?? { total: 0, mismatch: 0 }
    existing.total++
    if (!e.match) existing.mismatch++
    byMetric.set(key, existing)
  }

  console.log('--- Summary by metric ---')
  console.log('metricId           | total | mismatch | match%')
  console.log('--------------------|-------|----------|-------')
  for (const [metricId, stats] of byMetric) {
    const pct = ((stats.total - stats.mismatch) / stats.total * 100).toFixed(1)
    console.log(`${metricId.padEnd(18)} | ${String(stats.total).padStart(5)} | ${String(stats.mismatch).padStart(8)} | ${pct}%`)
  }

  console.log(`\nTotal mismatches: ${mismatches.length}`)
  process.exit(mismatches.length > 0 ? 1 : 0)
}

main()
