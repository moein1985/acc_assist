/**
 * S31.3-S31.4: Refusal Analysis Script
 *
 * Reads audit log entries with stage='engine-refuse' or 'investigator-exhausted',
 * clusters similar normalized prompts, and outputs a report sorted by frequency.
 *
 * Usage:
 *   npx tsx scripts/ops/analyzeRefusals.ts [--audit-log <path>] [--output <path>]
 *
 * Defaults:
 *   --audit-log: %APPDATA%/acc-assist/logs/agent-audit.log (or --audit-log to override)
 *   --output:    ops/refusal-report-<date>.md
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

interface AuditEntry {
  timestamp: string
  requestId: string
  conversationId?: string
  stage: string
  prompt?: string
  refusalReason?: string
  normalizedPrompt?: string
  error?: string
}

interface Cluster {
  pattern: string
  reason: string
  count: number
  examples: string[]
  requestIds: string[]
  lastSeen: string
}

const REFUSAL_STAGES = new Set(['engine-refuse', 'investigator-exhausted'])

function parseArgs(): { auditLogPath: string; outputPath: string } {
  const args = process.argv.slice(2)
  let auditLogPath = ''
  let outputPath = ''

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--audit-log' && args[i + 1]) {
      auditLogPath = args[i + 1]
      i++
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1]
      i++
    }
  }

  if (!auditLogPath) {
    // Default path based on platform
    const platform = process.platform
    if (platform === 'win32') {
      auditLogPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'acc-assist', 'logs', 'agent-audit.log')
    } else if (platform === 'darwin') {
      auditLogPath = join(homedir(), 'Library', 'Application Support', 'acc-assist', 'logs', 'agent-audit.log')
    } else {
      auditLogPath = join(homedir(), '.config', 'acc-assist', 'logs', 'agent-audit.log')
    }
  }

  if (!outputPath) {
    const date = new Date().toISOString().slice(0, 10)
    outputPath = join(process.cwd(), 'ops', `refusal-report-${date}.md`)
  }

  return { auditLogPath, outputPath }
}

async function readAuditLog(filePath: string): Promise<AuditEntry[]> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch {
    console.error(`Cannot read audit log: ${filePath}`)
    return []
  }

  const entries: AuditEntry[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = JSON.parse(trimmed) as AuditEntry
      if (REFUSAL_STAGES.has(entry.stage)) {
        entries.push(entry)
      }
    } catch {
      // Skip malformed lines
    }
  }
  return entries
}

function clusterRefusals(entries: AuditEntry[]): Cluster[] {
  const clusterMap = new Map<string, Cluster>()

  for (const entry of entries) {
    const pattern = entry.normalizedPrompt ?? 'UNKNOWN'
    const reason = entry.refusalReason ?? 'no_metric'
    const key = `${pattern}::${reason}`

    const existing = clusterMap.get(key)
    if (existing) {
      existing.count++
      existing.requestIds.push(entry.requestId)
      if (entry.prompt && existing.examples.length < 3) {
        existing.examples.push(entry.prompt.slice(0, 120))
      }
      if (entry.timestamp > existing.lastSeen) {
        existing.lastSeen = entry.timestamp
      }
    } else {
      clusterMap.set(key, {
        pattern,
        reason,
        count: 1,
        examples: entry.prompt ? [entry.prompt.slice(0, 120)] : [],
        requestIds: [entry.requestId],
        lastSeen: entry.timestamp,
      })
    }
  }

  return Array.from(clusterMap.values()).sort((a, b) => b.count - a.count)
}

function generateReport(clusters: Cluster[], totalRefusals: number): string {
  const date = new Date().toISOString().slice(0, 10)
  const lines: string[] = [
    `# Refusal Analysis Report — ${date}`,
    '',
    `**Total refusals analyzed:** ${totalRefusals}`,
    `**Unique clusters:** ${clusters.length}`,
    '',
    '## Clusters by Frequency (Top 20)',
    '',
    '| # | Pattern | Reason | Count | Last Seen | Example |',
    '|---|---------|--------|-------|-----------|---------|',
  ]

  const top = clusters.slice(0, 20)
  for (let i = 0; i < top.length; i++) {
    const c = top[i]
    const example = c.examples[0]?.replace(/\|/g, '\\|').slice(0, 80) ?? '—'
    lines.push(`| ${i + 1} | ${c.pattern.replace(/\|/g, '\\|')} | ${c.reason} | ${c.count} | ${c.lastSeen.slice(0, 10)} | ${example} |`)
  }

  // Summary by reason
  const reasonCounts = new Map<string, number>()
  for (const c of clusters) {
    reasonCounts.set(c.reason, (reasonCounts.get(c.reason) ?? 0) + c.count)
  }

  lines.push('', '## Summary by Refusal Reason', '', '| Reason | Count | % |', '|--------|-------|---|')
  for (const [reason, count] of Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / totalRefusals) * 100).toFixed(1)
    lines.push(`| ${reason} | ${count} | ${pct}% |`)
  }

  // Recommendations
  lines.push('', '## Recommendations', '')
  const noMetricClusters = clusters.filter(c => c.reason === 'no_metric')
  const ambiguousClusters = clusters.filter(c => c.reason === 'ambiguous')
  const outOfScopeClusters = clusters.filter(c => c.reason === 'out_of_scope')
  const emptyDataClusters = clusters.filter(c => c.reason === 'empty_data')

  if (noMetricClusters.length > 0) {
    lines.push(`### no_metric (${noMetricClusters.length} clusters, ${noMetricClusters.reduce((s, c) => s + c.count, 0)} refusals)`)
    lines.push('- Review top patterns for potential new MetricDefinition additions')
    lines.push('- Each new metric must be verified via Phase 29 oracle before adding to registry')
    lines.push('')
  }
  if (ambiguousClusters.length > 0) {
    lines.push(`### ambiguous (${ambiguousClusters.length} clusters, ${ambiguousClusters.reduce((s, c) => s + c.count, 0)} refusals)`)
    lines.push('- Improve planner clarify routing or add anchor/excludeSignal to existing metrics')
    lines.push('')
  }
  if (outOfScopeClusters.length > 0) {
    lines.push(`### out_of_scope (${outOfScopeClusters.length} clusters, ${outOfScopeClusters.reduce((s, c) => s + c.count, 0)} refusals)`)
    lines.push('- These are healthy refusals (non-financial queries). No action needed.')
    lines.push('')
  }
  if (emptyDataClusters.length > 0) {
    lines.push(`### empty_data (${emptyDataClusters.length} clusters, ${emptyDataClusters.reduce((s, c) => s + c.count, 0)} refusals)`)
    lines.push('- Metric exists but returned no data. Check if fiscal year or filter is correct.')
    lines.push('')
  }

  return lines.join('\n')
}

async function main(): Promise<void> {
  const { auditLogPath, outputPath } = parseArgs()

  console.log(`Reading audit log: ${auditLogPath}`)
  const entries = await readAuditLog(auditLogPath)

  if (entries.length === 0) {
    console.log('No refusal entries found in audit log.')
    console.log(`\nTo generate test data, run the app and ask questions that get refused.`)
    return
  }

  console.log(`Found ${entries.length} refusal entries`)

  const clusters = clusterRefusals(entries)
  console.log(`Clustered into ${clusters.length} unique patterns`)

  const report = generateReport(clusters, entries.length)

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, report, 'utf8')
  console.log(`Report written to: ${outputPath}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
