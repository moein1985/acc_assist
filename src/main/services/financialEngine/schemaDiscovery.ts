/**
 * Schema Discovery Engine — Blind schema scanning for auto-detect path.
 *
 * S15.4: scanDatabaseSchema — INFORMATION_SCHEMA + sys.* scan
 * S15.5: sampleTableRows — SELECT TOP 5 from candidate tables
 * S15.6: filterRelevantTables — remove system/irrelevant tables
 */

import type { TableRef, ColumnRef } from './schemaAdapter'

// ─── Types ───

export type SqlExecutor = (sql: string) => Promise<Record<string, unknown>[]>

export interface RawTableInfo {
  tableRef: TableRef
  estimatedRowCount: number | null
  columns: RawColumnInfo[]
  foreignKeys: RawForeignKey[]
}

export interface RawColumnInfo {
  name: string
  dataType: string
  maxLength: number | null
  isNullable: boolean
  isIdentity: boolean
  isPrimaryKey: boolean
}

export interface RawForeignKey {
  column: string
  referencedTable: TableRef
  referencedColumn: string
}

export interface RawSchemaInventory {
  serverVersion: string
  databaseName: string
  tables: RawTableInfo[]
  scannedAt: string
}

export interface TableSample {
  tableRef: TableRef
  columns: RawColumnInfo[]
  rows: Record<string, unknown>[]
}

// ─── S15.4: scanDatabaseSchema ───

const SERVER_INFO_QUERY = `
SELECT TOP (1)
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS server_version,
  DB_NAME() AS database_name`

const TABLES_QUERY = `
SELECT
  s.name AS schema_name,
  t.name AS table_name,
  CAST(COALESCE(SUM(p.rows), 0) AS bigint) AS estimated_row_count
FROM sys.tables t
INNER JOIN sys.schemas s
  ON s.schema_id = t.schema_id
LEFT JOIN sys.partitions p
  ON p.object_id = t.object_id
  AND p.index_id IN (0, 1)
WHERE t.is_ms_shipped = 0
GROUP BY s.name, t.name
ORDER BY s.name, t.name`

const COLUMNS_QUERY = `
SELECT
  s.name AS schema_name,
  t.name AS table_name,
  c.name AS column_name,
  ty.name AS data_type,
  CAST(c.max_length AS int) AS max_length,
  CAST(c.is_nullable AS int) AS is_nullable,
  CAST(c.is_identity AS int) AS is_identity
FROM sys.tables t
INNER JOIN sys.schemas s
  ON s.schema_id = t.schema_id
INNER JOIN sys.columns c
  ON c.object_id = t.object_id
INNER JOIN sys.types ty
  ON ty.user_type_id = c.user_type_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.column_id`

const PRIMARY_KEYS_QUERY = `
SELECT
  s.name AS schema_name,
  t.name AS table_name,
  c.name AS column_name
FROM sys.key_constraints kc
INNER JOIN sys.tables t
  ON t.object_id = kc.parent_object_id
INNER JOIN sys.schemas s
  ON s.schema_id = t.schema_id
INNER JOIN sys.index_columns ic
  ON ic.object_id = kc.parent_object_id
  AND ic.index_id = kc.unique_index_id
INNER JOIN sys.columns c
  ON c.object_id = ic.object_id
  AND c.column_id = ic.column_id
WHERE kc.type = 'PK'
ORDER BY s.name, t.name, ic.key_ordinal`

const FOREIGN_KEYS_QUERY = `
SELECT
  ps.name AS schema_name,
  pt.name AS table_name,
  pc.name AS column_name,
  rs.name AS referenced_schema,
  rt.name AS referenced_table,
  rc.name AS referenced_column
FROM sys.foreign_key_columns fkc
INNER JOIN sys.tables pt
  ON pt.object_id = fkc.parent_object_id
INNER JOIN sys.schemas ps
  ON ps.schema_id = pt.schema_id
INNER JOIN sys.columns pc
  ON pc.object_id = fkc.parent_object_id
  AND pc.column_id = fkc.parent_column_id
INNER JOIN sys.tables rt
  ON rt.object_id = fkc.referenced_object_id
INNER JOIN sys.schemas rs
  ON rs.schema_id = rt.schema_id
INNER JOIN sys.columns rc
  ON rc.object_id = fkc.referenced_object_id
  AND rc.column_id = fkc.referenced_column_id
ORDER BY ps.name, pt.name, fkc.constraint_column_id`

function toStr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return fallback
}

function toNullableNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'bigint') return value === 1n
  if (typeof value === 'string') return value.trim() === '1' || value.trim().toLowerCase() === 'true'
  return false
}

function tableKey(schema: string, table: string): string {
  return schema.toLowerCase() + '.' + table.toLowerCase()
}

export async function scanDatabaseSchema(executeSql: SqlExecutor): Promise<RawSchemaInventory> {
  const serverRows = await executeSql(SERVER_INFO_QUERY)
  const serverInfo = serverRows[0] ?? {}
  const serverVersion = toStr(serverInfo['server_version'], 'Unknown')
  const databaseName = toStr(serverInfo['database_name'], '')

  const tableRows = await executeSql(TABLES_QUERY)
  const tableMap = new Map<string, RawTableInfo>()

  for (const row of tableRows) {
    const schemaName = toStr(row['schema_name'])
    const tableName = toStr(row['table_name'])
    if (!schemaName || !tableName) continue
    const key = tableKey(schemaName, tableName)
    tableMap.set(key, {
      tableRef: { schema: schemaName, table: tableName },
      estimatedRowCount: toNullableNum(row['estimated_row_count']),
      columns: [],
      foreignKeys: [],
    })
  }

  const columnRows = await executeSql(COLUMNS_QUERY)
  for (const row of columnRows) {
    const schemaName = toStr(row['schema_name'])
    const tableName = toStr(row['table_name'])
    const key = tableKey(schemaName, tableName)
    const table = tableMap.get(key)
    if (!table) continue
    const columnName = toStr(row['column_name'])
    if (!columnName) continue
    table.columns.push({
      name: columnName,
      dataType: toStr(row['data_type'], 'unknown'),
      maxLength: toNullableNum(row['max_length']),
      isNullable: toBool(row['is_nullable']),
      isIdentity: toBool(row['is_identity']),
      isPrimaryKey: false,
    })
  }

  const pkRows = await executeSql(PRIMARY_KEYS_QUERY)
  for (const row of pkRows) {
    const schemaName = toStr(row['schema_name'])
    const tableName = toStr(row['table_name'])
    const columnName = toStr(row['column_name'])
    const key = tableKey(schemaName, tableName)
    const table = tableMap.get(key)
    if (!table || !columnName) continue
    const col = table.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase())
    if (col) col.isPrimaryKey = true
  }

  const fkRows = await executeSql(FOREIGN_KEYS_QUERY)
  for (const row of fkRows) {
    const schemaName = toStr(row['schema_name'])
    const tableName = toStr(row['table_name'])
    const columnName = toStr(row['column_name'])
    const key = tableKey(schemaName, tableName)
    const table = tableMap.get(key)
    if (!table || !columnName) continue
    table.foreignKeys.push({
      column: columnName,
      referencedTable: {
        schema: toStr(row['referenced_schema']),
        table: toStr(row['referenced_table']),
      },
      referencedColumn: toStr(row['referenced_column']),
    })
  }

  return {
    serverVersion,
    databaseName,
    tables: Array.from(tableMap.values()),
    scannedAt: new Date().toISOString(),
  }
}

// ─── S15.5: sampleTableRows ───

function quoteIdentifier(value: string): string {
  const escaped = value.replace(/\]/g, ']]')
  return '[' + escaped + ']'
}

export async function sampleTableRows(
  tableRef: TableRef,
  executeSql: SqlExecutor,
  limit = 5
): Promise<TableSample> {
  const schema = quoteIdentifier(tableRef.schema)
  const table = quoteIdentifier(tableRef.table)
  const sql = 'SELECT TOP (' + limit + ') * FROM ' + schema + '.' + table
  const rows = await executeSql(sql)
  return {
    tableRef,
    columns: [],
    rows,
  }
}

export async function sampleMultipleTables(
  tables: TableRef[],
  executeSql: SqlExecutor,
  limit = 5
): Promise<TableSample[]> {
  const samples: TableSample[] = []
  for (const ref of tables) {
    try {
      const sample = await sampleTableRows(ref, executeSql, limit)
      if (sample.rows.length > 0) {
        samples.push(sample)
      }
    } catch {
      // Skip tables that error (permissions, etc.)
    }
  }
  return samples
}

// ─── S15.6: filterRelevantTables ───

const SYSTEM_SCHEMA_PATTERNS = [/^sys$/, /^__/, /^dtproperties$/i, /^cdc$/i]
const SYSTEM_TABLE_PATTERNS = [/^sys/i, /^__/, /^dt/i, /^MS/i, /^database_/i, /^trace/i]
const IRRELEVANT_TABLE_PATTERNS = [
  /migration/i, /audit/i, /_log$/i, /elog/i, /history$/i,
  /backup/i, /temp$/i, /tmp$/i, /staging$/i,
]

const RELEVANT_TABLE_PATTERNS = [
  /account/i, /accounts/i, /ledger/i, /chart/i, /coa/i,
  /voucher/i, /journal/i, /entry/i, /sanad/i, /سند/i,
  /invoice/i, /factor/i, /فاکتور/i, /فاكتور/i,
  /party/i, /customer/i, /vendor/i, /partner/i, /client/i, /supplier/i,
  /fiscal/i, /year/i, /سال/i, /period/i,
  /inventory/i, /receipt/i, /stock/i, /warehouse/i, /انبار/i,
  /check/i, /cheque/i, /چک/i,
  /bank/i, /cash/i, /payment/i,
  /purchase/i, /sales/i, /sale/i, /bill/i,
  /tax/i, /مالیات/i,
  /cost/i, /project/i, /center/i,
]

function isSystemTable(schema: string, table: string): boolean {
  if (SYSTEM_SCHEMA_PATTERNS.some((p) => p.test(schema))) return true
  if (SYSTEM_TABLE_PATTERNS.some((p) => p.test(table))) return true
  return false
}

function isIrrelevantTable(table: string): boolean {
  return IRRELEVANT_TABLE_PATTERNS.some((p) => p.test(table))
}

function isRelevantTable(schema: string, table: string): boolean {
  const searchSource = schema + ' ' + table
  return RELEVANT_TABLE_PATTERNS.some((p) => p.test(searchSource))
}

export function filterRelevantTables(
  inventory: RawSchemaInventory
): RawTableInfo[] {
  return inventory.tables.filter((t) => {
    const { schema, table } = t.tableRef
    if (isSystemTable(schema, table)) return false
    if (isIrrelevantTable(table)) return false
    if (t.estimatedRowCount !== null && t.estimatedRowCount === 0) return false
    if (isRelevantTable(schema, table)) return true
    // Keep tables that have FKs to/from relevant tables
    if (t.foreignKeys.length > 0) return true
    return false
  })
}

// ─── Helper: build ColumnRef from table + column name ───

export function makeColumnRef(tableRef: TableRef, column: string): ColumnRef {
  return { schema: tableRef.schema, table: tableRef.table, column }
}
