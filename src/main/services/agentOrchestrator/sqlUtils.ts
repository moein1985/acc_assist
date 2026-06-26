/**
 * SQL utility methods extracted from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import {
  buildDatabaseSchemaQuery,
  escapeSqlStringLiteral,
  normalizeTablePattern
} from '../agentToolArgumentUtils'

export function quoteSqlIdentifier(value: string): string {
  return `[${value.replace(/\]/g, ']]')}]`
}

export function quoteSqlTableRef(ref: string): string {
  const dotIndex = ref.indexOf('.')
  if (dotIndex === -1) {
    return quoteSqlIdentifier(ref)
  }
  const schema = ref.slice(0, dotIndex)
  const table = ref.slice(dotIndex + 1)
  return `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`
}

export function toSafeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim()
    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

export function toOptionalFiniteInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export function toFiniteInteger(value: unknown): number {
  const parsed = toOptionalFiniteInteger(value)
  return parsed ?? 0
}

export function buildPendingToolStatusText(
  toolName: string,
  args: Record<string, unknown>
): string {
  if (toolName === 'list_database_tables') {
    return '🔍 در حال جستجو و استخراج لیست جداول دیتابیس...'
  }

  if (toolName === 'get_database_schema') {
    const tableNameArg = args['table_name']
    const tableName =
      typeof tableNameArg === 'string' && tableNameArg.trim() ? tableNameArg.trim() : 'نامشخص'
    return `📋 در حال تحلیل ساختار و ستون‌های جدول [${tableName}]...`
  }

  if (toolName === 'fetch_financial_data') {
    return '📊 در حال اجرای کوئری مالی روی دیتابیس و استخراج ردیف‌ها...'
  }

  return `🧩 در حال اجرای ابزار ${toolName}...`
}

export function buildCatalogScanQuery(tablePattern: string | null, limit: number): string {
  const normalizedPattern = normalizeTablePattern(tablePattern)
  const patternFilter = normalizedPattern
    ? `AND LOWER(t.TABLE_NAME) LIKE LOWER(N'${escapeSqlStringLiteral(normalizedPattern)}')`
    : ''

  return `SELECT TOP (${Math.max(1, Math.min(limit, 24))})
  t.TABLE_SCHEMA,
  t.TABLE_NAME,
  CAST(COALESCE(SUM(p.rows), 0) AS bigint) AS estimated_row_count
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN sys.partitions p
  ON p.object_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME))
 AND p.index_id IN (0, 1)
WHERE t.TABLE_TYPE = 'BASE TABLE'
  ${patternFilter}
  AND t.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
ORDER BY estimated_row_count DESC, t.TABLE_SCHEMA, t.TABLE_NAME`
}

export function buildListDatabaseTablesQuery(
  tablePattern: string | null,
  maxTableListRows: number
): string {
  const normalizedPattern = normalizeTablePattern(tablePattern)
  const patternFilter = normalizedPattern
    ? `\n  AND LOWER(TABLE_NAME) LIKE LOWER(N'${escapeSqlStringLiteral(normalizedPattern)}')`
    : ''

  return `SELECT TOP (${maxTableListRows}) TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'${patternFilter}
ORDER BY TABLE_SCHEMA, TABLE_NAME`
}

export function buildDatabaseSchemaQueryWrapper(
  tableName: string,
  schemaName: string | null,
  maxSchemaRows: number
): string {
  return buildDatabaseSchemaQuery(tableName, schemaName, maxSchemaRows)
}
