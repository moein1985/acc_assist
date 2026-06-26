/**
 * Fiscal year fallback and deterministic markdown composers extracted
 * from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import type { AgentProgressEvent, AppSettings, SqlQueryRow } from '../../../shared/contracts'
import type { RuntimeScopeColumnCandidate } from './sqlExecution'
import type { DeterministicFinancialIntent } from './intentRouting'
import type { DeterministicFinancialToolResult } from '../agentOrchestrator'
import type { ConversationMemoryState } from './conversationMemory'

export type FiscalYearFallbackResult = {
  count: number
  years: number[]
  tableRef: string
  columnName: string
  minYear: number | null
  maxYear: number | null
  toolCallsUsed: number
}

export interface FiscalYearFallbackDeps {
  findActiveSchemaCatalog: (settings: AppSettings) => SchemaCatalogEntry | null
  collectRuntimeScopeColumnCandidates: (
    catalog: SchemaCatalogEntry
  ) => RuntimeScopeColumnCandidate[]
  executeMetadataSql: (sql: string, signal: AbortSignal) => Promise<SqlQueryRow[]>
  executeReadOnlySql: (sql: string, signal: AbortSignal) => Promise<SqlQueryRow[]>
  throwIfRequestCanceled: (signal: AbortSignal) => void
  parseSqlTableReference: (
    rawRef: string
  ) => { schemaName: string | null; tableName: string } | null
  quoteSqlIdentifier: (value: string) => string
  toFiniteInteger: (value: unknown) => number
  toOptionalFiniteInteger: (value: unknown) => number | null
  rememberToolTrace: (memory: ConversationMemoryState, trace: string) => void
  emitProgress: (
    onProgress: ((event: AgentProgressEvent) => void) | undefined,
    event: AgentProgressEvent
  ) => void
}

import type { SchemaCatalogEntry } from '../../../shared/contracts'

export async function tryResolveFiscalYearFallback(
  deps: FiscalYearFallbackDeps,
  deterministicIntent: DeterministicFinancialIntent,
  settings: AppSettings,
  conversationMemory: ConversationMemoryState,
  signal: AbortSignal,
  onProgress?: (event: AgentProgressEvent) => void
): Promise<FiscalYearFallbackResult | null> {
  const activeCatalog = deps.findActiveSchemaCatalog(settings)
  let toolCallsUsed = 0
  let metadataRows: SqlQueryRow[] = []

  let fiscalCandidates: RuntimeScopeColumnCandidate[] = []

  if (activeCatalog) {
    fiscalCandidates = deps
      .collectRuntimeScopeColumnCandidates(activeCatalog)
      .filter((candidate) => candidate.dimension === 'fiscalYear')
      .slice(0, 8)
  }

  if (fiscalCandidates.length === 0) {
    metadataRows = await deps.executeMetadataSql(
      `SELECT TOP (48)
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
  AND (
    c.COLUMN_NAME LIKE N'%fiscal%'
    OR c.COLUMN_NAME LIKE N'%year%'
    OR c.COLUMN_NAME LIKE N'%period%'
    OR c.COLUMN_NAME LIKE N'%سال%'
    OR c.COLUMN_NAME LIKE N'%مالی%'
    OR c.COLUMN_NAME LIKE N'%دوره%'
    OR c.TABLE_NAME LIKE N'%FiscalYear%'
    OR c.TABLE_NAME LIKE N'%Fiscal_Year%'
    OR c.TABLE_NAME LIKE N'%سال%مالی%'
    OR c.TABLE_NAME LIKE N'%دوره%مالی%'
  )
ORDER BY
  CASE WHEN c.TABLE_SCHEMA IN ('ACC', 'RPA') THEN 0 ELSE 1 END,
  c.TABLE_SCHEMA,
  c.TABLE_NAME,
  c.ORDINAL_POSITION`,
      signal
    )

    toolCallsUsed += 1

    const metadataCandidates: RuntimeScopeColumnCandidate[] = []

    for (const row of metadataRows) {
      const schemaName = String(row['table_schema'] ?? '').trim()
      const tableName = String(row['table_name'] ?? '').trim()
      const columnName = String(row['column_name'] ?? '').trim()

      if (!schemaName || !tableName || !columnName) {
        continue
      }

      metadataCandidates.push({
        dimension: 'fiscalYear',
        tableRef: `${schemaName}.${tableName}`,
        columnName,
        score: schemaName === 'ACC' || schemaName === 'RPA' ? 8 : 5,
        samplePreview: null
      })
    }

    fiscalCandidates = metadataCandidates.slice(0, 10)
  }

  if (fiscalCandidates.length === 0) {
    return null
  }

  type FiscalStats = {
    candidate: RuntimeScopeColumnCandidate
    count: number
    minYear: number | null
    maxYear: number | null
  }

  const successfulStats: FiscalStats[] = []

  for (const candidate of fiscalCandidates) {
    deps.throwIfRequestCanceled(signal)
    const tableRef = deps.parseSqlTableReference(candidate.tableRef)

    if (!tableRef?.schemaName || !tableRef.tableName) {
      continue
    }

    const schemaIdentifier = deps.quoteSqlIdentifier(tableRef.schemaName)
    const tableIdentifier = deps.quoteSqlIdentifier(tableRef.tableName)
    const columnIdentifier = deps.quoteSqlIdentifier(candidate.columnName)
    const fromClause = `${schemaIdentifier}.${tableIdentifier}`

    const statsQuery = `WITH fiscal_values AS (
  SELECT TRY_CONVERT(NVARCHAR(32), ${columnIdentifier}) AS fiscal_text
  FROM ${fromClause}
)
SELECT
  COUNT(DISTINCT TRY_CONVERT(INT, fiscal_text)) AS fiscal_year_count,
  MIN(TRY_CONVERT(INT, fiscal_text)) AS min_fiscal_year,
  MAX(TRY_CONVERT(INT, fiscal_text)) AS max_fiscal_year
FROM fiscal_values
WHERE fiscal_text LIKE '[12][0-9][0-9][0-9]'
  AND TRY_CONVERT(INT, fiscal_text) BETWEEN 1300 AND 2099`

    try {
      const rows = await deps.executeReadOnlySql(statsQuery, signal)
      toolCallsUsed += 1

      const row = rows[0] as SqlQueryRow | undefined
      const count = deps.toFiniteInteger(row?.['fiscal_year_count'])

      if (count <= 0) {
        continue
      }

      successfulStats.push({
        candidate,
        count,
        minYear: deps.toOptionalFiniteInteger(row?.['min_fiscal_year']),
        maxYear: deps.toOptionalFiniteInteger(row?.['max_fiscal_year'])
      })
    } catch {
      // Keep trying other fiscal-year candidates.
    }
  }

  if (successfulStats.length === 0) {
    const fiscalTableRows = await deps.executeMetadataSql(
      `SELECT TOP (240)
  t.TABLE_SCHEMA AS table_schema,
  t.TABLE_NAME AS table_name
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_TYPE = 'BASE TABLE'
  AND t.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
  AND (
    t.TABLE_NAME LIKE N'%FiscalYear%'
    OR t.TABLE_NAME LIKE N'%Fiscal_Year%'
    OR t.TABLE_NAME LIKE N'%Year%'
    OR t.TABLE_NAME LIKE N'%Period%'
    OR t.TABLE_NAME LIKE N'%سال%'
    OR t.TABLE_NAME LIKE N'%مالی%'
    OR t.TABLE_NAME LIKE N'%دوره%'
  )
ORDER BY
  CASE WHEN t.TABLE_SCHEMA IN ('FMK', 'ACC', 'RPA') THEN 0 ELSE 1 END,
  t.TABLE_SCHEMA,
  t.TABLE_NAME`,
      signal
    )

    toolCallsUsed += 1

    if (metadataRows.length === 0) {
      metadataRows = await deps.executeMetadataSql(
        `SELECT TOP (240)
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
        signal
      )

      toolCallsUsed += 1
    }

    for (const tableRow of fiscalTableRows) {
      const schemaName = String(tableRow['table_schema'] ?? '').trim()
      const tableName = String(tableRow['table_name'] ?? '').trim()

      if (!schemaName || !tableName) {
        continue
      }

      metadataRows.push({
        table_schema: schemaName,
        table_name: tableName,
        column_name: ''
      })
    }

    const tableCandidates = new Map<
      string,
      { schemaName: string; tableName: string; score: number }
    >()

    for (const row of metadataRows) {
      const schemaName = String(row['table_schema'] ?? '').trim()
      const tableName = String(row['table_name'] ?? '').trim()

      if (!schemaName || !tableName) {
        continue
      }

      const normalizedTable = tableName.toLowerCase()
      const normalizedSchema = schemaName.toLowerCase()
      let score = 0

      if (/fiscal\s*_?\s*year|سال\s*مالی|دوره\s*مالی/iu.test(tableName)) {
        score += 10
      }

      if (/year|period|سال|دوره/iu.test(tableName)) {
        score += 4
      }

      if (['fmk', 'acc', 'rpa'].includes(normalizedSchema)) {
        score += 3
      }

      if (score <= 0) {
        continue
      }

      const key = `${normalizedSchema}.${normalizedTable}`
      const existing = tableCandidates.get(key)

      if (!existing || score > existing.score) {
        tableCandidates.set(key, {
          schemaName,
          tableName,
          score
        })
      }
    }

    const rankedTables = [...tableCandidates.values()].sort(
      (left, right) => right.score - left.score
    )

    for (const candidate of rankedTables.slice(0, 6)) {
      deps.throwIfRequestCanceled(signal)

      const fromClause = `${deps.quoteSqlIdentifier(candidate.schemaName)}.${deps.quoteSqlIdentifier(candidate.tableName)}`
      const countQuery = `SELECT COUNT(1) AS fiscal_year_count FROM ${fromClause}`

      try {
        const rows = await deps.executeReadOnlySql(countQuery, signal)
        toolCallsUsed += 1

        const count = deps.toFiniteInteger(
          (rows[0] as SqlQueryRow | undefined)?.['fiscal_year_count']
        )

        if (count <= 0 || count > 300) {
          continue
        }

        const tableRef = `${candidate.schemaName}.${candidate.tableName}`

        deps.rememberToolTrace(
          conversationMemory,
          `fallback:${deterministicIntent} table=${tableRef} row_count=${count}`
        )

        deps.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ ابزار ${deterministicIntent} اجرا شد: ${count} سال مالی (row-count fallback) در ${tableRef}`,
          toolName: deterministicIntent,
          rowCount: count
        })

        return {
          count,
          years: [],
          tableRef,
          columnName: '(row-count)',
          minYear: null,
          maxYear: null,
          toolCallsUsed
        }
      } catch {
        // Continue with the next candidate table.
      }
    }

    return null
  }

  successfulStats.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count
    }

    if (right.candidate.score !== left.candidate.score) {
      return right.candidate.score - left.candidate.score
    }

    return left.candidate.tableRef.localeCompare(right.candidate.tableRef)
  })

  const best = successfulStats[0]
  const bestRef = deps.parseSqlTableReference(best.candidate.tableRef)

  if (!bestRef?.schemaName || !bestRef.tableName) {
    return null
  }

  const previewQuery = `WITH fiscal_values AS (
  SELECT DISTINCT TRY_CONVERT(INT, TRY_CONVERT(NVARCHAR(32), ${deps.quoteSqlIdentifier(best.candidate.columnName)})) AS fiscal_year
  FROM ${deps.quoteSqlIdentifier(bestRef.schemaName)}.${deps.quoteSqlIdentifier(bestRef.tableName)}
  WHERE TRY_CONVERT(NVARCHAR(32), ${deps.quoteSqlIdentifier(best.candidate.columnName)}) LIKE '[12][0-9][0-9][0-9]'
)
SELECT TOP (48) fiscal_year
FROM fiscal_values
WHERE fiscal_year BETWEEN 1300 AND 2099
ORDER BY fiscal_year DESC`

  let previewYears: number[] = []

  try {
    const previewRows = await deps.executeReadOnlySql(previewQuery, signal)
    toolCallsUsed += 1
    previewYears = previewRows
      .map((row) => deps.toOptionalFiniteInteger(row['fiscal_year']))
      .filter((value): value is number => value !== null)
  } catch {
    previewYears = []
  }

  deps.rememberToolTrace(
    conversationMemory,
    `fallback:${deterministicIntent} table=${best.candidate.tableRef} column=${best.candidate.columnName} count=${best.count}`
  )

  deps.emitProgress(onProgress, {
    type: 'tool-success',
    message: `✅ ابزار ${deterministicIntent} اجرا شد: ${best.count} سال مالی در ${best.candidate.tableRef}.${best.candidate.columnName}`,
    toolName: deterministicIntent,
    rowCount: best.count
  })

  return {
    count: best.count,
    years: previewYears,
    tableRef: best.candidate.tableRef,
    columnName: best.candidate.columnName,
    minYear: best.minYear,
    maxYear: best.maxYear,
    toolCallsUsed
  }
}

export function composeDeterministicFinancialToolMarkdown(
  deterministicIntent: DeterministicFinancialIntent,
  result: DeterministicFinancialToolResult
): string {
  const label =
    deterministicIntent === 'get_account_balance'
      ? 'مانده حساب'
      : deterministicIntent === 'get_party_balance'
        ? 'مانده طرف حساب'
        : deterministicIntent === 'get_purchase_summary'
          ? 'خلاصه خرید'
          : deterministicIntent === 'get_receivables_summary'
            ? 'خلاصه بدهکاران'
            : deterministicIntent === 'get_payables_summary'
              ? 'خلاصه بستانکاران'
              : 'خلاصه جریان نقد'

  const isPurchaseFromInventory =
    deterministicIntent === 'get_purchase_summary' && result.tableRef === 'INV.InventoryReceipt'
  const hasNoData = result.value === null || result.value === 0

  const summaryText = hasNoData
    ? `این گزارش با داده‌های موجود قابل تولید نیست. ${label} در جدول ${result.tableRef} خالی است.`
    : isPurchaseFromInventory
      ? `فاکتور خرید رسمی ثبت نشده؛ بر اساس رسید انبار (غیرمرجوعی)، ${label} محاسبه شد: ${result.value}`
      : `${label} بر اساس داده‌های read-only و mapping schema محاسبه شد: ${result.value} (نوع KPI: ${label})`

  const assumptionsText = isPurchaseFromInventory
    ? '- مبلغ از رسید انبار `TotalPrice` با `IsReturn=0` است، نه فاکتور خرید رسمی.'
    : '- از mapping انتخاب‌شده schema و ستون عددی قابل‌محاسبه استفاده شد؛ در صورت تفاوت نام ستون، نتیجه ممکن است محدود شود.'

  return [
    '### Summary',
    summaryText,
    '',
    '### Findings',
    `- مسیر پاسخ: deterministic`,
    `- intent قطعی: ${deterministicIntent}`,
    `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
    '',
    '### Evidence',
    `- ابزار قطعی ${deterministicIntent} با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
    `- query: ${result.query}`,
    '',
    '### Assumptions',
    assumptionsText,
    '',
    '### Actions',
    '- اگر منظورتان حساب یا بازه زمانی خاصی است، scope دقیق‌تر را مشخص کنید.'
  ].join('\n')
}

export function composeFiscalYearDeterministicMarkdown(
  deterministicIntent: DeterministicFinancialIntent,
  result: FiscalYearFallbackResult
): string {
  const yearSpanText =
    result.minYear !== null && result.maxYear !== null
      ? `${result.minYear} تا ${result.maxYear}`
      : 'نامشخص'
  const previewText = result.years.length > 0 ? result.years.join('، ') : 'نمونه معتبر بازیابی نشد.'

  if (deterministicIntent === 'list_fiscal_years') {
    const listedYears =
      result.years.length > 0 ? result.years.join('، ') : 'سال مالی قابل اتکا یافت نشد.'

    return [
      '### Summary',
      `فهرست سال های مالی شناسایی شده (fiscal years): ${listedYears} (نوع KPI: سال مالی)`,
      '',
      '### Findings',
      '- مسیر پاسخ: deterministic',
      `- تعداد کل سال های مالی متمایز: ${result.count}`,
      `- بازه سال ها: ${yearSpanText}`,
      `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
      '',
      '### Evidence',
      `- ابزار قطعی list_fiscal_years با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
      '- Listed distinct fiscal_year values from the detected fiscal-year column using the read-only path.',
      '- فقط مقادیر 4 رقمی در بازه 1300 تا 2099 در خروجی لحاظ شدند.',
      '',
      '### Assumptions',
      '- فرض اصلی: از جدول/ستون شناسایی‌شده برای سال مالی و مسیر read-only استفاده شده است؛ اگر schema متفاوت باشد، نتیجه ممکن است محدود شود.',
      '',
      '### Actions',
      '- اگر منظور شما شرکت یا شعبه خاصی است، scope را مشخص کنید تا لیست محدودشده ارائه شود.'
    ].join('\n')
  }

  return [
    '### Summary',
    `در دیتابیس فعلی ${result.count} سال مالی متمایز شناسایی شد (${result.count} fiscal years).`,
    '',
    '### Findings',
    '- مسیر پاسخ: deterministic',
    `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
    `- بازه سال ها: ${yearSpanText}`,
    `- نمونه سال های بازیابی شده (نزولی): ${previewText}`,
    '',
    '### Evidence',
    `- ابزار قطعی count_fiscal_years با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
    '- Counted distinct fiscal_year values from the detected fiscal-year column using the read-only path.',
    '- فقط مقادیر 4 رقمی در بازه 1300 تا 2099 در شمارش لحاظ شدند.',
    '',
    '### Assumptions',
    '- فرض اصلی: از جدول/ستون شناسایی‌شده برای سال مالی و مسیر read-only استفاده شده است؛ اگر schema متفاوت باشد، نتیجه ممکن است محدود شود.',
    '',
    '### Actions',
    '- اگر منظورتان سال مالی یک شرکت یا شعبه خاص است، نام شرکت/شعبه را اعلام کنید تا شمارش scope-based انجام شود.'
  ].join('\n')
}
