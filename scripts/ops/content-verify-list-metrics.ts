/**
 * S33.10: Content-sampling oracles for list metrics.
 * Updates the registry to replace count-proxy oracles with content-sampling oracles
 * that return >=3 sample rows with key columns. Sets status to needs_accountant_review
 * where professional judgment is required (period boundaries, trend logic).
 */
import { readFileSync, writeFileSync } from 'fs'

interface RegistryEntry {
  metricId: string
  tier: string
  status: string
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

const registryPath = './scripts/fixtures/metric-verification-registry.json'
const registry: RegistryEntry[] = JSON.parse(readFileSync(registryPath, 'utf8'))

let updatedCount = 0

// Content-sampling oracle definitions for each count-proxy list metric
const contentOracles: Record<string, {
  oracleSql: string
  notes: string
  status: string // needs_accountant_review (can't verify content without live pass)
}> = {
  fiscal_year_list: {
    oracleSql: "SELECT TOP 3 FiscalYearId, Title, StartDate, EndDate FROM FMK.FiscalYear ORDER BY FiscalYearId",
    notes: 'S33.10: Content-sampling oracle — 3 sample rows (FiscalYearId, Title, StartDate, EndDate). Content verification requires live engine pass to compare row values.',
    status: 'oracle_only'
  },
  sales_by_period: {
    oracleSql: "SELECT TOP 3 MONTH(src.Date) AS MonthNum, SUM(src.NetPriceInBaseCurrency) AS MonthlySales FROM SLS.Invoice src WHERE src.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') GROUP BY MONTH(src.Date) ORDER BY MonthNum",
    notes: 'S33.10: Content-sampling oracle — 3 sample rows (MonthNum, MonthlySales). Period boundary logic requires accountant review to confirm correct month grouping.',
    status: 'needs_accountant_review'
  },
  recent_documents: {
    oracleSql: "SELECT TOP 3 v.VoucherId, v.Date, v.Number, v.Type FROM ACC.Voucher v WHERE v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') AND v.Type NOT IN (3, 4) ORDER BY v.Date DESC",
    notes: 'S33.10: Content-sampling oracle — 3 most recent vouchers (VoucherId, Date, Number, Type). Content verification requires live engine pass.',
    status: 'oracle_only'
  },
  vouchers_by_date: {
    oracleSql: "SELECT TOP 3 CONVERT(DATE, v.Date) AS VoucherDate, COUNT(*) AS VoucherCount FROM ACC.Voucher v WHERE v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') AND v.Type NOT IN (3, 4) GROUP BY CONVERT(DATE, v.Date) ORDER BY VoucherDate DESC",
    notes: 'S33.10: Content-sampling oracle — 3 sample dates (VoucherDate, VoucherCount). Grouping by date requires accountant review to confirm correct aggregation.',
    status: 'needs_accountant_review'
  },
  vouchers_by_type: {
    oracleSql: "SELECT TOP 3 v.Type, COUNT(*) AS TypeCount FROM ACC.Voucher v WHERE v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') AND v.Type NOT IN (3, 4) GROUP BY v.Type ORDER BY v.Type",
    notes: 'S33.10: Content-sampling oracle — 3 sample types (Type, TypeCount). Type semantics (1=normal, 2=?) require accountant review.',
    status: 'needs_accountant_review'
  },
  tax_monthly_summary: {
    oracleSql: "SELECT TOP 3 MONTH(src.Date) AS MonthNum, SUM(src.TaxInBaseCurrency) AS MonthlyTax FROM SLS.Invoice src WHERE src.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') GROUP BY MONTH(src.Date) ORDER BY MonthNum",
    notes: 'S33.10: Content-sampling oracle — 3 sample rows (MonthNum, MonthlyTax). Tax monthly grouping requires accountant review to confirm correct period logic.',
    status: 'needs_accountant_review'
  },
  period_comparison: {
    oracleSql: "SELECT TOP 3 fy.Title AS FiscalYear, SUM(vi.Debit) AS TotalDebit, SUM(vi.Credit) AS TotalCredit FROM ACC.Voucher v JOIN ACC.VoucherItem vi ON v.VoucherId = vi.VoucherRef JOIN FMK.FiscalYear fy ON v.FiscalYearRef = fy.FiscalYearId WHERE v.Type NOT IN (3, 4) GROUP BY fy.Title ORDER BY fy.Title DESC",
    notes: 'S33.10: Content-sampling oracle — 3 sample years (FiscalYear, TotalDebit, TotalCredit). Cross-year comparison logic requires accountant review.',
    status: 'needs_accountant_review'
  },
  trend_analysis: {
    oracleSql: "SELECT TOP 3 fy.Title AS FiscalYear, SUM(vi.Debit) - SUM(vi.Credit) AS NetMovement FROM ACC.Voucher v JOIN ACC.VoucherItem vi ON v.VoucherId = vi.VoucherRef JOIN FMK.FiscalYear fy ON v.FiscalYearRef = fy.FiscalYearId WHERE v.Type NOT IN (3, 4) GROUP BY fy.Title ORDER BY fy.Title DESC",
    notes: 'S33.10: Content-sampling oracle — 3 sample years (FiscalYear, NetMovement). Trend analysis methodology requires accountant review.',
    status: 'needs_accountant_review'
  },
  cogs_detailed: {
    oracleSql: "SELECT TOP 3 vi.VoucherRef, vi.Debit, vi.Credit, a.Code, a.Title FROM ACC.VoucherItem vi JOIN ACC.Voucher v ON vi.VoucherRef = v.VoucherId JOIN ACC.Account a ON vi.AccountSLRef = a.AccountId WHERE v.Type NOT IN (3, 4) AND EXISTS (SELECT 1 FROM ACC.Account p1 WHERE p1.AccountId = a.ParentAccountRef AND EXISTS (SELECT 1 FROM ACC.Account p2 WHERE p2.AccountId = p1.ParentAccountRef AND p2.Type = 1 AND p2.Code = '61')) AND v.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') ORDER BY vi.VoucherRef",
    notes: 'S33.10: Content-sampling oracle — 3 sample rows (VoucherRef, Debit, Credit, Code, Title). COGS account hierarchy requires accountant review.',
    status: 'needs_accountant_review'
  },
  vat_detailed: {
    oracleSql: "SELECT TOP 3 src.InvoiceId, src.Date, src.NetPriceInBaseCurrency, src.TaxInBaseCurrency FROM SLS.Invoice src WHERE ISNULL(src.TaxInBaseCurrency, 0) > 0 AND src.FiscalYearRef = (SELECT FiscalYearId FROM FMK.FiscalYear WHERE Title = N'1402') ORDER BY src.InvoiceId",
    notes: 'S33.10: Content-sampling oracle — 3 sample invoices (InvoiceId, Date, NetPrice, Tax). VAT detail content requires live engine pass to compare.',
    status: 'oracle_only'
  }
}

registry.forEach(entry => {
  const oracle = contentOracles[entry.metricId]
  if (!oracle) return

  const oldNotes = entry.notes
  entry.oracleSql = oracle.oracleSql
  entry.status = oracle.status
  entry.notes = oracle.notes + (oldNotes ? ' | Previous: ' + oldNotes : '')
  entry.verifiedAt = '2026-07-03'
  updatedCount++
})

writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8')

console.log(`S33.10: Updated ${updatedCount} list metric entries with content-sampling oracles.`)
console.log('Status breakdown:')
const needsReview = registry.filter(e => Object.keys(contentOracles).includes(e.metricId) && e.status === 'needs_accountant_review').length
const oracleOnly = registry.filter(e => Object.keys(contentOracles).includes(e.metricId) && e.status === 'oracle_only').length
console.log(`  needs_accountant_review: ${needsReview}`)
console.log(`  oracle_only: ${oracleOnly}`)
