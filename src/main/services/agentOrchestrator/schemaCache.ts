/**
 * Schema cache and query prevalidation logic extracted from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import type {
  AppSettings,
  SchemaCatalogEntry,
  SchemaColumnCatalogItem,
  SqlQueryRow
} from '../../../shared/contracts'

export interface SchemaCacheDeps {
  schemaTableListCache: Map<string, { rows: SqlQueryRow[]; timestamp: number }>
  schemaCacheByTableKey: Map<string, { schema: SchemaColumnCatalogItem[]; timestamp: number }>
  SCHEMA_CACHE_TTL_MS: number
  executeMetadataSql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  findActiveSchemaCatalog: (settings: AppSettings) => SchemaCatalogEntry | null
  normalizeTableRef: (tableRef: string) => string
}

export async function fetchTableListCached(
  deps: SchemaCacheDeps,
  tablePattern: string | null,
  sqlQuery: string,
  abortSignal: AbortSignal
): Promise<SqlQueryRow[]> {
  const normalized = (tablePattern ?? '').trim().toLowerCase()
  const cacheKey = normalized ? `pattern:${normalized}` : 'all'

  const cached = deps.schemaTableListCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp <= deps.SCHEMA_CACHE_TTL_MS) {
    return [...cached.rows]
  }

  const rows = await deps.executeMetadataSql(sqlQuery, abortSignal)
  deps.schemaTableListCache.set(cacheKey, { rows, timestamp: Date.now() })
  return rows
}

export function prevalidateFinancialQuery(
  deps: SchemaCacheDeps,
  sqlQuery: string,
  settings: AppSettings
): string {
  const activeCatalog = deps.findActiveSchemaCatalog(settings)

  if (!activeCatalog) {
    return sqlQuery
  }

  let rewritten = sqlQuery

  const identifierPattern = /\b(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\b/g

  for (const table of activeCatalog.tables) {
    const tableName = table.tableName.trim()
    const schemaName = table.schemaName.trim()
    const cacheKey = `${schemaName || 'dbo'}.${tableName}`
    const cachedColumnList = deps.schemaCacheByTableKey.get(cacheKey)
    const availableColumns = cachedColumnList?.schema.length
      ? cachedColumnList.schema.map((column) => column.name.trim()).filter(Boolean)
      : table.columns.map((column) => column.name.trim()).filter(Boolean)

    if (availableColumns.length === 0) {
      continue
    }

    const normalizedTableRef = normalizeTableReference(
      deps.normalizeTableRef,
      `${schemaName}.${tableName}`
    )
    const tableRefPattern = new RegExp(
      `\\b(?:\\[${schemaName}\\]\\.|${schemaName}\\.)?\\[?${tableName}\\]?\\b`,
      'gi'
    )

    rewritten = rewritten.replace(tableRefPattern, (match) => match)
    rewritten = rewritten.replace(identifierPattern, (match) => {
      const rawName = match.replace(/\[|\]|`/g, '')
      const canonical = resolveColumnNameAlias(rawName, availableColumns)

      if (!canonical || canonical.trim().toLowerCase() === rawName.trim().toLowerCase()) {
        return match
      }

      const candidate = canonical.trim().toLowerCase()
      const normalizedMatch = rawName.trim().toLowerCase()

      if (normalizedMatch === candidate) {
        return canonical
      }

      if (availableColumns.some((column) => column.trim().toLowerCase() === normalizedMatch)) {
        return canonical
      }

      return match
    })

    const canonicalTableToken = availableColumns.some(
      (column) => column.toLowerCase() === normalizedTableRef
    )
    if (canonicalTableToken) {
      rewritten = rewritten.replace(new RegExp(`\\b${tableName}\\b`, 'gi'), tableName)
    }
  }

  return rewritten
}

export async function getCachedSchemaSnapshot(
  deps: SchemaCacheDeps,
  cacheKey: string,
  sqlQuery: string,
  abortSignal: AbortSignal
): Promise<{ rows: SqlQueryRow[] }> {
  const cached = deps.schemaCacheByTableKey.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < deps.SCHEMA_CACHE_TTL_MS) {
    return {
      rows: cached.schema.map((col, idx) => ({
        table_schema: cacheKey.split('.').slice(0, -1).join('.') || 'dbo',
        table_name: cacheKey.split('.').pop() || '',
        ordinal_position: String(idx + 1),
        column_name: col.name,
        data_type: col.dataType,
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        datetime_precision: null,
        is_nullable: col.isNullable ? 1 : 0,
        is_identity: col.isIdentity ? 1 : 0
      }))
    }
  }

  const rows = await deps.executeMetadataSql(sqlQuery, abortSignal)
  const schemaColumns: SchemaColumnCatalogItem[] = rows.map((row) => {
    const colName = row['column_name']
    const dataType = row['data_type']
    const maxLen = row['character_maximum_length']
    const isNullable = row['is_nullable']
    const isIdentity = row['is_identity']
    return {
      name: typeof colName === 'string' ? colName : String(colName || ''),
      dataType: typeof dataType === 'string' ? dataType : 'unknown',
      isNullable: Boolean(isNullable),
      maxLength: typeof maxLen === 'number' && maxLen > 0 ? maxLen : null,
      isIdentity: Boolean(isIdentity),
      isPrimaryKey: false,
      hasForeignKey: false,
      sampleValues: []
    }
  })

  deps.schemaCacheByTableKey.set(cacheKey, { schema: schemaColumns, timestamp: Date.now() })

  return { rows }
}

export function normalizeTableReference(
  normalizeTableRefFn: (tableRef: string) => string,
  tableRef: string
): string {
  return normalizeTableRefFn(tableRef)
    .replace(/\[|\]|`|"/g, '')
    .replace(/\s+/g, '')
}

export function resolveColumnNameAlias(columnName: string, availableColumns: string[]): string {
  const normalizedTarget = columnName.trim().toLowerCase()
  const normalizedAvailable = availableColumns.map((entry) => entry.trim().toLowerCase())

  if (normalizedAvailable.includes(normalizedTarget)) {
    return availableColumns[normalizedAvailable.indexOf(normalizedTarget)]
  }

  const aliasMap: Record<string, string> = {
    name: 'Title',
    title: 'Title',
    date: 'DocDate',
    docdate: 'DocDate',
    doc_date: 'DocDate',
    documentdate: 'DocDate',
    document_date: 'DocDate'
  }

  const alias = aliasMap[normalizedTarget]
  if (alias && normalizedAvailable.includes(alias.toLowerCase())) {
    return alias
  }

  const fuzzy = availableColumns.find((entry) => entry.trim().toLowerCase() === normalizedTarget)
  if (fuzzy) {
    return fuzzy
  }

  return columnName
}
