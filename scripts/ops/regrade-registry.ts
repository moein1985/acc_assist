/**
 * S33.1-S33.2 — Registry regrade: downgrade sweep-verified to oracle_only
 * Only entries with real engineRequestId (ssh-*) stay 'verified'.
 * Also fixes purchases oracle (S33.4) and tax_paid/tax_collected (S33.7).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface RegistryEntry {
  metricId: string
  tier: 'T1' | 'T2' | 'T3'
  status: 'verified' | 'oracle_only' | 'unverified' | 'not_applicable' | 'needs_accountant_review'
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

let regraded = 0
let stayedVerified = 0

for (const entry of registry) {
  if (entry.status === 'verified') {
    if (entry.engineRequestId.startsWith('ssh-')) {
      // Truly dual-source verified — keep
      stayedVerified++
    } else {
      // Only oracle-verified (sweep) — downgrade
      entry.status = 'oracle_only'
      entry.notes = entry.notes + ' | S33.2: Downgraded from verified to oracle_only (no live engineRequestId)'
      regraded++
    }
  }
}

// S33.4: Fix purchases oracle — use INV.InventoryReceipt instead of empty POM.PurchaseInvoice
const purchases = registry.find(e => e.metricId === 'purchases')
if (purchases) {
  purchases.status = 'oracle_only'
  purchases.expectedValue = 226110419451
  purchases.oracleSql = "SELECT ISNULL(SUM(TotalPrice), 0) FROM INV.InventoryReceipt WHERE IsReturn = 0 AND FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')"
  purchases.engineRequestId = ''
  purchases.diff = null
  purchases.notes = 'S33.4: Fixed oracle from POM.PurchaseInvoice (empty, 0 rows) to INV.InventoryReceipt (IsReturn=0). Expected=226,110,419,451. Needs live engine pass for verified.'
}

// S33.7: Fix tax_paid — change from Title-based heuristic to column-based source
const taxPaid = registry.find(e => e.metricId === 'tax_paid')
if (taxPaid) {
  taxPaid.status = 'needs_accountant_review'
  taxPaid.expectedValue = null
  taxPaid.oracleSql = "SELECT ISNULL(SUM(TaxInBaseCurrency), 0) FROM INV.InventoryReceipt WHERE IsReturn = 0 AND FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')"
  taxPaid.engineRequestId = ''
  taxPaid.diff = null
  taxPaid.notes = 'S33.7: Title LIKE %مالیات% returned 0 (no matching accounts). Changed to column-based source: SUM(TaxInBaseCurrency) from INV.InventoryReceipt (purchase-side tax). Needs accountant review to confirm this is the correct source for input VAT.'
}

// S33.7: Fix tax_collected — use SLS.Invoice.TaxInBaseCurrency (same as vat_liability)
const taxCollected = registry.find(e => e.metricId === 'tax_collected')
if (taxCollected) {
  taxCollected.status = 'oracle_only'
  taxCollected.expectedValue = 2029051751
  taxCollected.oracleSql = "SELECT ISNULL(SUM(TaxInBaseCurrency), 0) FROM SLS.Invoice WHERE FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')"
  taxCollected.engineRequestId = ''
  taxCollected.diff = null
  taxCollected.notes = 'S33.7: Title LIKE %مالیات% returned 0. Changed to column-based: SUM(TaxInBaseCurrency) from SLS.Invoice = 2,029,051,751 (same as vat_liability). Needs live engine pass for verified.'
}

writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8')

console.log('=== S33.1-S33.2 Registry Regrade ===')
console.log(`Stayed verified (ssh-* engineRequestId): ${stayedVerified}`)
console.log(`Downgraded to oracle_only: ${regraded}`)
console.log(`Total entries: ${registry.length}`)

// Summary by status
const byStatus: Record<string, number> = {}
for (const e of registry) {
  byStatus[e.status] = (byStatus[e.status] || 0) + 1
}
console.log('\nBy status:')
for (const [status, count] of Object.entries(byStatus)) {
  console.log(`  ${status}: ${count}`)
}

// List the truly verified
console.log('\nTruly verified (dual-source live):')
for (const e of registry) {
  if (e.status === 'verified') {
    console.log(`  - ${e.metricId} (engineRequestId=${e.engineRequestId})`)
  }
}
