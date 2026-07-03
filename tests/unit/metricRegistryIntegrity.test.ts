import { describe, it } from 'node:test'
import { strictEqual, ok } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getMetricCatalog } from '../../src/main/services/financialEngine/metricCatalog'

// S29.3 — Registry integrity: every metricId in catalog has exactly one record, no orphans

interface RegistryEntry {
  metricId: string
  tier: 'T1' | 'T2' | 'T3'
  status: 'verified' | 'unverified' | 'not_applicable' | 'needs_accountant_review'
}

describe('S29.3: Metric Verification Registry Integrity', () => {
  const registryPath = join(__dirname, '..', '..', 'scripts', 'fixtures', 'metric-verification-registry.json')
  const raw = readFileSync(registryPath, 'utf-8')
  const registry: RegistryEntry[] = JSON.parse(raw)
  const catalog = getMetricCatalog()

  it('every metric in catalog has exactly one registry record', () => {
    const registryIds = new Set(registry.map((r) => r.metricId))
    for (const metric of catalog) {
      ok(registryIds.has(metric.id), `Metric "${metric.id}" missing from registry`)
    }
    strictEqual(registry.length, catalog.length, 'Registry length must match catalog length')
  })

  it('no orphan records in registry (every registry entry exists in catalog)', () => {
    const catalogIds = new Set(catalog.map((m) => m.id))
    for (const entry of registry) {
      ok(catalogIds.has(entry.metricId), `Registry entry "${entry.metricId}" has no matching catalog metric`)
    }
  })

  it('no duplicate metricIds in registry', () => {
    const ids = registry.map((r) => r.metricId)
    const unique = new Set(ids)
    strictEqual(ids.length, unique.size, 'Duplicate metricIds found in registry')
  })

  it('every entry has a valid tier', () => {
    for (const entry of registry) {
      ok(['T1', 'T2', 'T3'].includes(entry.tier), `Invalid tier "${entry.tier}" for metric "${entry.metricId}"`)
    }
  })

  it('every entry has a valid status', () => {
    for (const entry of registry) {
      ok(
        ['verified', 'unverified', 'not_applicable', 'needs_accountant_review'].includes(entry.status),
        `Invalid status "${entry.status}" for metric "${entry.metricId}"`,
      )
    }
  })

  it('seed metrics are verified', () => {
    const seedIds = ['net_sales', 'trial_balance', 'cash_bank_balance', 'receivables', 'payables']
    for (const id of seedIds) {
      const entry = registry.find((r) => r.metricId === id)
      ok(entry, `Seed metric "${id}" not found`)
      strictEqual(entry!.status, 'verified', `Seed metric "${id}" should be verified`)
    }
  })
})
