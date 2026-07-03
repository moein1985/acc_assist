/**
 * S29.2 — verify-metric-registry.ts
 * Reports verification coverage by tier and status.
 *
 * Run: npx tsx scripts/ops/verify-metric-registry.ts
 *   or: npm run verify:registry
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface RegistryEntry {
  metricId: string
  tier: 'T1' | 'T2' | 'T3'
  status: 'verified' | 'unverified' | 'not_applicable' | 'needs_accountant_review'
  expectedValue: number | null
  fiscalYear: string | null
  oracleSql: string
  engineRequestId: string
  diff: number | null
  tolerance: number | null
  verifiedAt: string
  commit: string
  notes: string
}

const registryPath = join(__dirname, '..', 'fixtures', 'metric-verification-registry.json')
const raw = readFileSync(registryPath, 'utf-8')
const registry: RegistryEntry[] = JSON.parse(raw)

// ── Summary ──
const tiers: Array<'T1' | 'T2' | 'T3'> = ['T1', 'T2', 'T3']
const statuses: Array<RegistryEntry['status']> = [
  'verified', 'unverified', 'not_applicable', 'needs_accountant_review',
]

console.log('=== Metric Verification Registry Report ===\n')

let totalVerified = 0
let totalMetrics = registry.length

for (const tier of tiers) {
  const tierEntries = registry.filter((r) => r.tier === tier)
  const tierVerified = tierEntries.filter((r) => r.status === 'verified').length
  if (tier === 'T1') totalVerified += tierVerified

  console.log(`Tier ${tier}: ${tierVerified}/${tierEntries.length} verified (${tierEntries.length ? Math.round((tierVerified / tierEntries.length) * 100) : 0}%)`)

  for (const status of statuses) {
    const entries = tierEntries.filter((r) => r.status === status)
    if (entries.length > 0) {
      console.log(`  ${status}: ${entries.length}`)
      if (status === 'unverified') {
        for (const e of entries) {
          console.log(`    - ${e.metricId}`)
        }
      }
    }
  }
  console.log()
}

const overallVerified = registry.filter((r) => r.status === 'verified').length
console.log(`Overall: ${overallVerified}/${totalMetrics} verified (${Math.round((overallVerified / totalMetrics) * 100)}%)`)

// ── Exit code: 0 if T1 has no unverified entries, 1 otherwise ──
// needs_accountant_review and not_applicable are valid non-verified statuses
const t1Unverified = registry.filter((r) => r.tier === 'T1' && r.status === 'unverified')
if (t1Unverified.length > 0) {
  console.log(`\nWARNING: ${t1Unverified.length} T1 metrics still unverified`)
  process.exit(1)
} else {
  const t1NeedsReview = registry.filter((r) => r.tier === 'T1' && r.status === 'needs_accountant_review').length
  console.log(`\nT1 has no unverified metrics. (${t1NeedsReview} need accountant review — Phase 30)`)
  process.exit(0)
}
