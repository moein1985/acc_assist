/**
 * S29.1 — Generate metric-verification-registry.json from metricCatalog.
 *
 * Produces one record per metricId with tier assignment and seed verified entries.
 * Run: npx tsx scripts/ops/generate-verification-registry.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getMetricCatalog } from '../../src/main/services/financialEngine/metricCatalog'

// ── Tier assignments (from FRE_ROADMAP_28_VERIFICATION_OVERVIEW.fa.md §28.5) ──

const T1_METRICS = new Set([
  'trial_balance', 'trial_balance_check', 'receivables', 'payables',
  'receivables_aging', 'payables_aging', 'net_sales', 'purchases',
  'net_profit', 'income_statement', 'balance_sheet', 'sales_reconciliation',
  'cash_bank_balance',
  // Balance-sheet / income-statement components (high sensitivity)
  'total_assets', 'total_liabilities', 'total_equity',
  'total_revenue', 'total_expenses',
  // Reconciliations (core accountant trust)
  'purchase_reconciliation', 'inventory_reconciliation',
])

const T3_METRICS = new Set([
  'depreciation_summary', 'fixed_assets_register',
  'cost_center_summary', 'cost_center_detailed', 'cost_allocation',
  'project_summary', 'project_profitability',
  'budget_variance', 'budget_report',
  'inventory_turnover', 'trend_analysis',
  'bank_reconciliation', 'cash_flow_statement', 'cash_flow_direct',
  'payroll', 'low_stock_items',
])

function tierOf(metricId: string): 'T1' | 'T2' | 'T3' {
  if (T1_METRICS.has(metricId)) return 'T1'
  if (T3_METRICS.has(metricId)) return 'T3'
  return 'T2'
}

// ── Seed verified metrics (from §28.0 independent sqlcmd audit) ──

interface SeedEntry {
  expectedValue: number
  oracleSql: string
  engineRequestId: string
  notes: string
}

const SEEDS: Record<string, SeedEntry> = {
  net_sales: {
    expectedValue: 64252437897,
    oracleSql: "SELECT SUM(NetPriceInBaseCurrency) FROM SLS.Invoice WHERE FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')",
    engineRequestId: 'ssh-1783030859177',
    notes: 'SUM(NetPriceInBaseCurrency) SLS.Invoice, year 1402',
  },
  trial_balance: {
    expectedValue: 566396483280,
    oracleSql: "SELECT SUM(vi.Debit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId WHERE v.Type NOT IN (3,4) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')",
    engineRequestId: 'ssh-1783030876140',
    notes: 'SUM(Debit) with Type NOT IN(3,4), year 1402. Debit=Credit=566,396,483,280',
  },
  cash_bank_balance: {
    expectedValue: 9521507066,
    oracleSql: "SELECT (SELECT ISNULL(SUM(Balance),0) FROM RPA.CashBalance) + (SELECT ISNULL(SUM(Balance),0) FROM RPA.BankAccountBalance)",
    engineRequestId: 'ssh-1783030871009',
    notes: 'RPA.CashBalance + RPA.BankAccountBalance (cash 2,127,900,602 + bank 7,393,606,464)',
  },
  receivables: {
    expectedValue: 14392491310,
    oracleSql: "SELECT SUM(vi.Debit - vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code IN ('12','13') AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '11')) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')",
    engineRequestId: 'ssh-1783030881416',
    notes: 'Debit-Credit, accounts 12/13 under 11 (current assets), year 1402',
  },
  payables: {
    expectedValue: -26058866504,
    oracleSql: "SELECT SUM(vi.Debit - vi.Credit) FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3,4) AND a.ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 2 AND Code IN ('10','12') AND ParentAccountRef IN (SELECT AccountId FROM ACC.Account WHERE Type = 1 AND Code = '21')) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402')",
    engineRequestId: 'ssh-1783030893623',
    notes: 'Debit-Credit, accounts 10/12 under 21 (current liabilities), year 1402',
  },
}

// ── Build registry ──

const catalog = getMetricCatalog()
const now = new Date().toISOString().split('T')[0]

const registry = catalog.map((metric) => {
  const tier = tierOf(metric.id)
  const seed = SEEDS[metric.id]

  if (seed) {
    return {
      metricId: metric.id,
      tier,
      status: 'verified',
      expectedValue: seed.expectedValue,
      fiscalYear: '1402',
      oracleSql: seed.oracleSql,
      engineRequestId: seed.engineRequestId,
      diff: 0,
      tolerance: 0,
      verifiedAt: now,
      commit: '',
      notes: seed.notes,
    }
  }

  return {
    metricId: metric.id,
    tier,
    status: 'unverified',
    expectedValue: null,
    fiscalYear: null,
    oracleSql: '',
    engineRequestId: '',
    diff: null,
    tolerance: null,
    verifiedAt: '',
    commit: '',
    notes: '',
  }
})

const outputPath = join(__dirname, '..', 'fixtures', 'metric-verification-registry.json')
writeFileSync(outputPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8')

// Summary
const byTier = { T1: { total: 0, verified: 0 }, T2: { total: 0, verified: 0 }, T3: { total: 0, verified: 0 } }
for (const r of registry) {
  byTier[r.tier as keyof typeof byTier].total++
  if (r.status === 'verified') byTier[r.tier as keyof typeof byTier].verified++
}

console.log(`Registry written to ${outputPath}`)
console.log(`Total metrics: ${registry.length}`)
console.log(`T1: ${byTier.T1.verified}/${byTier.T1.total} verified`)
console.log(`T2: ${byTier.T2.verified}/${byTier.T2.total} verified`)
console.log(`T3: ${byTier.T3.verified}/${byTier.T3.total} verified`)
console.log(`Overall: ${registry.filter(r => r.status === 'verified').length}/${registry.length} verified`)
