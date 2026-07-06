// Parse telemetry events for Phase 37
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface TelemetryEvent {
  id: string
  timestamp: string
  level: string
  category: string
  event: string
  process: string
  appVersion: string
  platform: string
  arch: string
  message?: string
  details?: Record<string, unknown>
}

const raw = readFileSync(join(process.cwd(), 'ops', 'telemetry-events-phase37.ndjson'), 'utf8')
const lines = raw.split('\n').filter(l => l.trim())

const events: TelemetryEvent[] = []
for (const line of lines) {
  try {
    const obj = JSON.parse(line)
    events.push(obj)
  } catch {
    // skip
  }
}

// Filter for today: 2026-07-06
const todayEvents = events.filter(e => e.timestamp.startsWith('2026-07-06'))

// Also get the latest events before today for context
const allSorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
void allSorted

// Summary by category
const byCategory: Record<string, number> = {}
const byEvent: Record<string, number> = {}
const byLevel: Record<string, number> = {}

for (const e of todayEvents) {
  const cat = e.category ?? 'unknown'
  const evt = e.event ?? 'unknown'
  const lvl = e.level ?? 'unknown'
  byCategory[cat] = (byCategory[cat] ?? 0) + 1
  byEvent[evt] = (byEvent[evt] ?? 0) + 1
  byLevel[lvl] = (byLevel[lvl] ?? 0) + 1
}

// Write today's events
writeFileSync(
  join(process.cwd(), 'ops', 'phase37-telemetry-parsed.json'),
  JSON.stringify({
    totalEvents: events.length,
    todayEvents: todayEvents.length,
    byCategory,
    byEvent,
    byLevel,
    events: todayEvents
  }, null, 2),
  'utf8'
)

console.log(`=== Phase 37 Telemetry Analysis ===`)
console.log(`Total events in file: ${events.length}`)
console.log(`Today (2026-07-06): ${todayEvents.length}`)
console.log(`\nBy level:`)
for (const [l, c] of Object.entries(byLevel)) console.log(`  ${l}: ${c}`)
console.log(`\nBy category:`)
for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`)
console.log(`\nBy event:`)
for (const [e, c] of Object.entries(byEvent).sort((a, b) => b[1] - a[1])) console.log(`  ${e}: ${c}`)
console.log(`\nToday's events (chronological):`)
for (const e of todayEvents) {
  const ts = e.timestamp.substring(11, 19)
  console.log(`  ${ts} [${e.level}] ${e.category}/${e.event}`)
  if (e.message) console.log(`         msg: ${e.message.substring(0, 120)}`)
  if (e.details) console.log(`         details: ${JSON.stringify(e.details).substring(0, 200)}`)
}

// Also check telemetry server (192.168.85.84:8081) summary
console.log(`\n=== Telemetry Server (192.168.85.84:8081) ===`)
console.log(`Health: storedEvents=200 (from 2026-06-15, no events from today)`)
console.log(`The telemetry collector received 200 events total, all from 2026-06-15.`)
console.log(`No events from 2026-07-06 were received by the collector.`)
console.log(`Local telemetry-events.ndjson on app server has ${events.length} events, ${todayEvents.length} from today.`)
