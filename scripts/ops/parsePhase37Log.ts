// Parse audit log for Phase 37 — count all today's interactions
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface LogEntry {
  timestamp: string
  requestId: string
  conversationId: string
  stage: string
  prompt: string
  refusalReason?: string
  normalizedPrompt?: string
  error?: string
  toolName?: string
}

const raw = readFileSync(join(process.cwd(), 'ops', 'agent-audit-phase37.log'), 'utf8')
const lines = raw.split('\n').filter(l => l.trim())

const entries: LogEntry[] = []
for (const line of lines) {
  try {
    const obj = JSON.parse(line)
    entries.push(obj)
  } catch {
    // skip
  }
}

// Filter for today: 2026-07-06
const todayEntries = entries.filter(e => e.timestamp.startsWith('2026-07-06'))

// Group by requestId
const byRequest = new Map<string, LogEntry[]>()
for (const e of todayEntries) {
  const arr = byRequest.get(e.requestId) ?? []
  arr.push(e)
  byRequest.set(e.requestId, arr)
}

interface Result {
  requestId: string
  timestamp: string
  userPrompt: string
  stage: string
  metricId?: string
  verdict?: string
  refusalReason?: string
  error?: string
}

const results: Result[] = []

for (const [_reqId, group] of byRequest) {
  const engineServed = group.find(e => e.prompt?.startsWith('engine-served:'))
  const engineRefuse = group.find(e => e.stage === 'engine-refuse')
  const engineModeWithError = group.find(e => e.stage === 'engine-mode' && e.prompt !== 'ENGINE_ONLY_ENTRY' && !e.prompt.startsWith('engine-served:'))
  const textGuidance = group.find(e => e.stage === 'text-guidance')

  let userPrompt = ''
  let stage = ''
  let metricId: string | undefined
  let verdict: string | undefined
  let refusalReason: string | undefined
  let error: string | undefined

  if (engineServed) {
    stage = 'engine-served'
    const match = engineServed.prompt.match(/metricId=(\S+)\s+verdict=(\w+)/)
    if (match) {
      metricId = match[1]
      verdict = match[2]
    }
    userPrompt = '(prompt not logged for successful queries)'
  } else if (engineRefuse) {
    stage = 'engine-refuse'
    userPrompt = engineRefuse.prompt
    refusalReason = engineRefuse.refusalReason
    error = engineRefuse.error
    if (engineModeWithError?.error) {
      error = engineModeWithError.error
    }
  } else if (textGuidance) {
    stage = 'text-guidance'
    userPrompt = '(text guidance)'
  } else if (engineModeWithError) {
    stage = 'engine-mode-error'
    userPrompt = engineModeWithError.prompt
    refusalReason = engineModeWithError.refusalReason
    error = engineModeWithError.error
  } else {
    continue
  }

  const ts = group[0]?.timestamp ?? ''
  results.push({
    requestId: _reqId,
    timestamp: ts,
    userPrompt,
    stage,
    metricId,
    verdict,
    refusalReason,
    error
  })
}

results.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

writeFileSync(
  join(process.cwd(), 'ops', 'phase37-parsed.json'),
  JSON.stringify(results.map((r, i) => ({ index: i + 1, ...r })), null, 2),
  'utf8'
)

const summary = {
  total: results.length,
  engineServed: results.filter(r => r.stage === 'engine-served').length,
  engineRefuse: results.filter(r => r.stage === 'engine-refuse').length,
  textGuidance: results.filter(r => r.stage === 'text-guidance').length,
  engineModeError: results.filter(r => r.stage === 'engine-mode-error').length,
  byMetric: {} as Record<string, number>,
  byRefusalReason: {} as Record<string, number>,
  errors: results.filter(r => r.error).map(r => ({ prompt: r.userPrompt, error: r.error }))
}

for (const r of results) {
  if (r.metricId) {
    summary.byMetric[r.metricId] = (summary.byMetric[r.metricId] ?? 0) + 1
  }
  if (r.refusalReason) {
    summary.byRefusalReason[r.refusalReason] = (summary.byRefusalReason[r.refusalReason] ?? 0) + 1
  }
}

writeFileSync(
  join(process.cwd(), 'ops', 'phase37-summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8'
)

console.log(`=== Phase 37 Field Test — 2026-07-06 ===`)
console.log(`Total interactions: ${results.length}`)
console.log(`Engine served (ok): ${summary.engineServed}`)
console.log(`Engine refuse: ${summary.engineRefuse}`)
console.log(`Text guidance: ${summary.textGuidance}`)
console.log(`Engine mode error: ${summary.engineModeError}`)
console.log(`\nBy metric (successful):`)
for (const [m, c] of Object.entries(summary.byMetric).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m}: ${c}`)
}
console.log(`\nBy refusal reason:`)
for (const [r, c] of Object.entries(summary.byRefusalReason)) {
  console.log(`  ${r}: ${c}`)
}
console.log(`\nFailed queries (${summary.errors.length}):`)
for (const e of summary.errors) {
  console.log(`  [FAIL] ${e.prompt}`)
  console.log(`         -> ${e.error}`)
}
console.log(`\nAll interactions (chronological):`)
for (let i = 0; i < results.length; i++) {
  const r = results[i]
  if (r.stage === 'engine-served') {
    console.log(`  ${i + 1}. OK ${r.metricId} (verdict=${r.verdict}) @ ${r.timestamp}`)
  } else if (r.stage === 'engine-refuse' || r.stage === 'engine-mode-error') {
    console.log(`  ${i + 1}. FAIL ${r.userPrompt} @ ${r.timestamp}`)
    if (r.error) console.log(`         -> ${r.error}`)
  } else {
    console.log(`  ${i + 1}. TEXT text-guidance @ ${r.timestamp}`)
  }
}
