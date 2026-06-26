/**
 * Sales-growth comparison helpers extracted from `agentOrchestrator.ts`
 * (FRE Roadmap F2.4). These will become the source for migrating the
 * "net_sales" metric to the semantic layer in Phase 2.
 *
 * Behaviour is identical to the original in-class methods — the orchestrator
 * delegates to these free functions via a {@link SalesGrowthDeps} context.
 */
import type {
  AccountingConceptKey,
  AppSettings,
  SchemaCatalogEntry,
  SqlQueryRow
} from '../../../shared/contracts'
import type { AuditLogEntry } from '../auditLogService'
import type { ConversationMemoryState } from '../agentOrchestrator'
import { extractYearComparison } from './routing'

export type SalesGrowthFallbackResult = {
  baseYear: number
  targetYear: number
  salesBase: number
  salesTarget: number
  percentChange: number | null
  query: string
  toolCallsUsed: number
}

type PreferredMapping = {
  tableRef: string
  source: 'selected' | 'suggested'
}

/**
 * Bound orchestrator helpers required by the sales-growth functions.
 * Each member mirrors the corresponding private method on the orchestrator.
 */
export interface SalesGrowthDeps {
  findActiveSchemaCatalog: (settings: AppSettings) => SchemaCatalogEntry | null
  resolvePreferredMapping: (
    activeCatalog: SchemaCatalogEntry,
    conceptKey: AccountingConceptKey,
    prompt?: string
  ) => { tableRef: string; source: string } | null
  normalizeTableRef: (tableRef: string) => string
  quoteSqlTableRef: (ref: string) => string
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  toSafeNumber: (value: unknown) => number
  rememberToolTrace: (memory: ConversationMemoryState, trace: string) => void
  throwIfRequestCanceled: (signal: AbortSignal) => void
  safeAuditWrite: (entry: AuditLogEntry) => Promise<void>
  compactText: (value: string, maxLength: number) => string
}

/**
 * Selects the source table/columns for sales-growth comparison, preferring
 * catalog-tagged tables and falling back to the locked Sepidar mapping.
 */
export function selectSalesGrowthSourceTable(
  deps: SalesGrowthDeps,
  activeCatalog: SchemaCatalogEntry | null
): {
  tableRef: string
  yearRefColumn: string
  amountColumn: string
} {
  if (activeCatalog) {
    const preferredConcepts = ['documentLines', 'documents', 'accounts'] as AccountingConceptKey[]
    const preferredMappings = preferredConcepts
      .map((conceptKey) => deps.resolvePreferredMapping(activeCatalog, conceptKey))
      .filter((mapping): mapping is PreferredMapping => Boolean(mapping))

    const catalogMappings = activeCatalog.tables
      .filter((table) => table.tags.length > 0)
      .map((table) => ({
        tableRef: deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`),
        source: 'suggested' as const
      }))
      .filter((mapping) => Boolean(mapping.tableRef)) as PreferredMapping[]

    const tableCandidates: PreferredMapping[] = [...preferredMappings, ...catalogMappings]

    const seen = new Set<string>()

    for (const candidate of tableCandidates) {
      const normalizedRef = deps.normalizeTableRef(candidate.tableRef)

      if (!normalizedRef || seen.has(normalizedRef)) {
        continue
      }

      seen.add(normalizedRef)

      const table = activeCatalog.tables.find((entry) => {
        return deps.normalizeTableRef(`${entry.schemaName}.${entry.tableName}`) === normalizedRef
      })

      if (!table) {
        continue
      }

      const yearColumn = table.columns.find((column) =>
        /(?:fiscal|year|period|سال|مالی|دوره)/iu.test(column.name)
      )?.name
      const amountColumn = table.columns.find((column) =>
        /(?:amount|price|netprice|gross|revenue|total|sale|sum)/iu.test(column.name)
      )?.name

      if (yearColumn && amountColumn) {
        return {
          tableRef: deps.quoteSqlTableRef(normalizedRef),
          yearRefColumn: yearColumn,
          amountColumn
        }
      }
    }
  }

  return {
    tableRef: deps.quoteSqlTableRef('SLS.Invoice'),
    yearRefColumn: 'FiscalYearRef',
    amountColumn: 'NetPriceInBaseCurrency'
  }
}

/**
 * Renders the sales-growth fallback markdown from a resolved result.
 */
export function composeSalesGrowthFallbackMarkdown(
  deps: SalesGrowthDeps,
  result: SalesGrowthFallbackResult
): string {
  const direction =
    result.percentChange == null
      ? 'نامشخص'
      : result.percentChange > 0
        ? 'رشد'
        : result.percentChange < 0
          ? 'کاهش'
          : 'بدون تغییر'

  const signedPercent =
    result.percentChange == null
      ? 'N/A'
      : `${result.percentChange >= 0 ? '+' : ''}${result.percentChange.toFixed(2)}%`

  const assumptionsLine =
    result.percentChange == null
      ? '- فروش سال مبنا صفر یا ناموجود بوده است؛ درصد تغییر قابل محاسبه نیست.'
      : '- درصد تغییر طبق فرمول ((فروش سال هدف - فروش سال مبنا) / فروش سال مبنا) * 100 محاسبه شد.'

  return [
    '### Summary',
    `فروش سال ${result.targetYear} نسبت به ${result.baseYear}: ${signedPercent} (${direction}) (نوع KPI: فروش سالانه)`,
    '',
    '### Findings',
    '- مسیر پاسخ: deterministic',
    `- فروش سال ${result.baseYear}: ${result.salesBase.toLocaleString('en-US')}`,
    `- فروش سال ${result.targetYear}: ${result.salesTarget.toLocaleString('en-US')}`,
    `- درصد تغییر: ${signedPercent}`,
    '',
    '### Evidence',
    '- منبع داده: ابزار fetch_financial_data با تجمیع جدول مالی انتخاب‌شده از catalog و ستون‌های سال/مبلغ',
    `- سال های مقایسه: ${result.baseYear} و ${result.targetYear}`,
    `- SQL: ${deps.compactText(result.query.replace(/\s+/g, ' '), 220)}`,
    '',
    '### Assumptions',
    assumptionsLine,
    '',
    '### Actions',
    '- در صورت نیاز، همین مقایسه را به تفکیک ماه/شعبه/شرکت هم می‌توانم ارائه کنم.',
    '- اگر تعریف فروش (مثلا NetPrice vs GrossPrice) باید تغییر کند، اعلام کنید تا کوئری اصلاح شود.'
  ].join('\n')
}

/**
 * Attempts a deterministic sales-growth percentage calculation by joining
 * the sales source table with the fiscal-year table and pivoting two periods.
 * Returns null on schema mismatch / no data, degrading to the model loop.
 */
export async function tryResolveSalesGrowthPercentFallback(
  deps: SalesGrowthDeps,
  prompt: string,
  settings: AppSettings,
  conversationMemory: ConversationMemoryState,
  signal: AbortSignal
): Promise<SalesGrowthFallbackResult | null> {
  const yearComparison = extractYearComparison(prompt)

  if (!yearComparison) {
    return null
  }

  const baseYear = yearComparison.baseYear
  const targetYear = yearComparison.targetYear

  if (!Number.isFinite(baseYear) || !Number.isFinite(targetYear)) {
    return null
  }

  const activeCatalog = deps.findActiveSchemaCatalog(settings)
  const salesSource = selectSalesGrowthSourceTable(deps, activeCatalog)
  const fiscalYearTable = deps.quoteSqlTableRef('FMK.FiscalYear')

  const sqlQuery = `WITH yearly_sales AS (\n  SELECT\n    fy.Title AS FiscalYearTitle,\n    SUM(CAST(src.${salesSource.amountColumn} AS decimal(18, 4))) AS TotalSales\n  FROM ${salesSource.tableRef} src\n  JOIN ${fiscalYearTable} fy ON src.${salesSource.yearRefColumn} = fy.FiscalYearId\n  WHERE fy.Title IN (N'${baseYear}', N'${targetYear}')\n  GROUP BY fy.Title\n),\npivoted AS (\n  SELECT\n    MAX(CASE WHEN FiscalYearTitle = N'${baseYear}' THEN TotalSales END) AS SalesBase,\n    MAX(CASE WHEN FiscalYearTitle = N'${targetYear}' THEN TotalSales END) AS SalesTarget\n  FROM yearly_sales\n)\nSELECT\n  ISNULL(SalesBase, 0) AS SalesBase,\n  ISNULL(SalesTarget, 0) AS SalesTarget,\n  CASE\n    WHEN SalesBase IS NULL OR SalesBase = 0 THEN NULL\n    ELSE CAST(((SalesTarget - SalesBase) * 100.0 / SalesBase) AS decimal(18, 4))\n  END AS PercentChange\nFROM pivoted`

  let firstRow: Record<string, unknown> = {}
  try {
    const rows = await deps.executeReadOnlySql(sqlQuery, signal)
    firstRow = (rows[0] ?? {}) as Record<string, unknown>
  } catch (error) {
    await deps.safeAuditWrite({
      timestamp: new Date().toISOString(),
      requestId: conversationMemory.conversationId,
      stage: 'tool-error',
      toolName: 'sales_growth_fallback',
      error: error instanceof Error ? error.message : String(error),
      errorCategory: 'deterministic-tool-failure'
    })
    return null
  }

  deps.throwIfRequestCanceled(signal)

  const salesBase = deps.toSafeNumber(firstRow['SalesBase'])
  const salesTarget = deps.toSafeNumber(firstRow['SalesTarget'])

  if (salesBase === 0 && salesTarget === 0) {
    return null
  }

  const percentRaw = deps.toSafeNumber(firstRow['PercentChange'])
  const percentChange = Number.isFinite(percentRaw) ? percentRaw : null

  deps.rememberToolTrace(
    conversationMemory,
    `sales_growth_fallback base=${baseYear} target=${targetYear} pct=${percentChange ?? 'null'}`
  )

  return {
    baseYear,
    targetYear,
    salesBase,
    salesTarget,
    percentChange,
    query: sqlQuery,
    toolCallsUsed: 1
  }
}

// Re-export for convenience — the orchestrator delegates isSalesGrowthPercentPrompt here too.
export { isSalesGrowthPercentPrompt } from './routing'
