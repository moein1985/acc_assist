import type {
  AccountingConceptKey,
  AccountingSoftwareId,
  SchemaCatalogEntry,
  SchemaColumnCatalogItem,
  SchemaConceptSelections,
  SchemaConceptSuggestions,
  SchemaDateMode,
  SchemaTableCatalogItem,
  SqlQueryRow
} from '../../shared/contracts'
import { detectAccountingSoftware, scoreTableForSoftwareConcept } from './accountingConnectorProfiles'
import { buildConnectorReadinessSummary, buildConnectorSchemaFingerprint, buildMappingCoverageSummary } from './connectorSdk'

const MAX_TABLES = 220
const MAX_COLUMNS_PER_TABLE = 120
const MAX_SAMPLE_TABLES = 12
const MAX_SAMPLE_VALUES_PER_COLUMN = 4
const SAMPLE_ROW_LIMIT = 3
const MAX_SUGGESTION_COUNT_PER_CONCEPT = 5
const MAX_DATE_EVIDENCE_ITEMS = 6
const MAX_DISCOVERY_SCHEMA_ROWS = MAX_TABLES * MAX_COLUMNS_PER_TABLE
const SCHEMA_DISCOVERY_CACHE_TTL_MS = 15 * 60 * 1000

type SqlExecutor = (query: string) => Promise<SqlQueryRow[]>

type TableRecord = {
  schemaName: string
  tableName: string
  estimatedRowCount: number | null
  tags: AccountingConceptKey[]
  columns: SchemaColumnCatalogItem[]
  foreignKeys: Array<{
    columnName: string
    referencedSchema: string
    referencedTable: string
    referencedColumn: string
  }>
}

const CONCEPT_PATTERNS: Record<AccountingConceptKey, RegExp[]> = {
  accounts: [/\baccount\b/i, /\baccounts\b/i, /\bledger\b/i, /\bchart\b/i, /\bcoa\b/i],
  documents: [/\bdocument\b/i, /\bdocuments\b/i, /\bvoucher\b/i, /\bjournal\b/i, /\bentry\b/i],
  documentLines: [/\bline\b/i, /\blines\b/i, /\bdetail\b/i, /\bdetails\b/i, /\barticle\b/i, /\bitem\b/i],
  counterparties: [/\bparty\b/i, /\bcustomer\b/i, /\bvendor\b/i, /\bperson\b/i, /\bclient\b/i],
  cashTransactions: [/\btransaction\b/i, /\breceipt\b/i, /\bpayment\b/i, /\bcash\b/i, /\bcashflow\b/i],
  costCenters: [/\bcost\s*center\b/i, /\bcost_center\b/i, /\bcostcenter\b/i],
  projects: [/\bproject\b/i, /\bprojects\b/i],
  banks: [/\bbank\b/i, /\bbanks\b/i],
  pettyCash: [/\bpetty\b/i, /\bimprest\b/i, /\bcashbox\b/i, /\bfund\b/i]
}

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
SELECT TOP (${MAX_DISCOVERY_SCHEMA_ROWS})
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
SELECT TOP (${MAX_DISCOVERY_SCHEMA_ROWS})
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
SELECT TOP (${MAX_DISCOVERY_SCHEMA_ROWS})
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

export class SchemaDiscoveryService {
  private readonly catalogCache = new Map<string, { catalog: SchemaCatalogEntry; fetchedAt: number }>()
  private readonly inFlightCatalogRequests = new Map<string, Promise<SchemaCatalogEntry>>()

  async discoverCatalog(params: {
    profileId: string
    databaseName: string
    softwareOverrideId?: AccountingSoftwareId | null
    previousSelectedMappings?: SchemaConceptSelections
    executeSql: SqlExecutor
  }): Promise<SchemaCatalogEntry> {
    const profileId = params.profileId.trim()
    const softwareOverrideId = this.normalizeSoftwareId(params.softwareOverrideId)
    const executeSql = params.executeSql

    if (!profileId) {
      throw new Error('شناسه پروفایل (Profile ID) برای کشف ساختار الزامی است.')
    }

    const cacheKey = this.buildCatalogCacheKey(profileId, params.databaseName, softwareOverrideId)
    const cached = this.catalogCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < SCHEMA_DISCOVERY_CACHE_TTL_MS) {
      return cached.catalog
    }

    const inflight = this.inFlightCatalogRequests.get(cacheKey)
    if (inflight) {
      return inflight
    }

    const request = this.discoverCatalogInternal({
      profileId,
      databaseName: params.databaseName,
      softwareOverrideId,
      previousSelectedMappings: params.previousSelectedMappings,
      executeSql
    }).finally(() => {
      this.inFlightCatalogRequests.delete(cacheKey)
    })

    this.inFlightCatalogRequests.set(cacheKey, request)

    const catalog = await request
    this.catalogCache.set(cacheKey, { catalog, fetchedAt: Date.now() })
    return catalog
  }

  private async discoverCatalogInternal(params: {
    profileId: string
    databaseName: string
    softwareOverrideId?: AccountingSoftwareId | null
    previousSelectedMappings?: SchemaConceptSelections
    executeSql: SqlExecutor
  }): Promise<SchemaCatalogEntry> {
    const profileId = params.profileId.trim()
    const softwareOverrideId = this.normalizeSoftwareId(params.softwareOverrideId)
    const executeSql = params.executeSql

    const serverInfoRows = await executeSql(SERVER_INFO_QUERY)
    const serverInfo = serverInfoRows[0] ?? {}
    const serverVersion = this.toStringValue(serverInfo['server_version'], 'Unknown')
    const detectedDatabaseName = this.toStringValue(serverInfo['database_name'], '')

    const rawTableRows = await executeSql(TABLES_QUERY)
    const totalTables = rawTableRows.length

    const includedTableRows = rawTableRows.slice(0, MAX_TABLES)
    const tableMap = new Map<string, TableRecord>()

    for (const row of includedTableRows) {
      const schemaName = this.toStringValue(row['schema_name'], '')
      const tableName = this.toStringValue(row['table_name'], '')

      if (!schemaName || !tableName) {
        continue
      }

      const key = this.toTableKey(schemaName, tableName)
      tableMap.set(key, {
        schemaName,
        tableName,
        estimatedRowCount: this.toNullableNumber(row['estimated_row_count']),
        tags: [],
        columns: [],
        foreignKeys: []
      })
    }

    const columnRows = await executeSql(COLUMNS_QUERY)
    for (const row of columnRows) {
      const schemaName = this.toStringValue(row['schema_name'], '')
      const tableName = this.toStringValue(row['table_name'], '')
      const key = this.toTableKey(schemaName, tableName)
      const table = tableMap.get(key)

      if (!table || table.columns.length >= MAX_COLUMNS_PER_TABLE) {
        continue
      }

      const columnName = this.toStringValue(row['column_name'], '')
      if (!columnName) {
        continue
      }

      table.columns.push({
        name: columnName,
        dataType: this.toStringValue(row['data_type'], 'unknown'),
        isNullable: this.toBooleanFlag(row['is_nullable']),
        maxLength: this.toNullableNumber(row['max_length']),
        isIdentity: this.toBooleanFlag(row['is_identity']),
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: []
      })
    }

    const primaryKeyRows = await executeSql(PRIMARY_KEYS_QUERY)
    for (const row of primaryKeyRows) {
      const schemaName = this.toStringValue(row['schema_name'], '')
      const tableName = this.toStringValue(row['table_name'], '')
      const columnName = this.toStringValue(row['column_name'], '')
      const key = this.toTableKey(schemaName, tableName)
      const table = tableMap.get(key)

      if (!table || !columnName) {
        continue
      }

      const column = table.columns.find((item) => item.name.toLowerCase() === columnName.toLowerCase())
      if (column) {
        column.isPrimaryKey = true
      }
    }

    const foreignKeyRows = await executeSql(FOREIGN_KEYS_QUERY)
    for (const row of foreignKeyRows) {
      const schemaName = this.toStringValue(row['schema_name'], '')
      const tableName = this.toStringValue(row['table_name'], '')
      const columnName = this.toStringValue(row['column_name'], '')
      const key = this.toTableKey(schemaName, tableName)
      const table = tableMap.get(key)

      if (!table || !columnName) {
        continue
      }

      table.foreignKeys.push({
        columnName,
        referencedSchema: this.toStringValue(row['referenced_schema'], ''),
        referencedTable: this.toStringValue(row['referenced_table'], ''),
        referencedColumn: this.toStringValue(row['referenced_column'], '')
      })

      const column = table.columns.find((item) => item.name.toLowerCase() === columnName.toLowerCase())
      if (column) {
        column.hasForeignKey = true
      }
    }

    const tables = Array.from(tableMap.values())
    for (const table of tables) {
      table.tags = this.detectTableTags(table)
    }

    const tableRefs = tables.map((table) => `${table.schemaName}.${table.tableName}`)
    const softwareDetection = detectAccountingSoftware(tableRefs)
    const connectorFingerprint = buildConnectorSchemaFingerprint(tableRefs)
    const effectiveSoftwareId = softwareOverrideId ?? softwareDetection.primary?.id ?? null

    const sampleTargets = this.pickSampleTables(tables)
    for (const table of sampleTargets) {
      await this.fillSampleValues(table, executeSql)
    }

    const suggestedMappings = this.buildSuggestedMappings(tables, effectiveSoftwareId)
    const selectedMappings = params.previousSelectedMappings ?? {}
    const coverageSummary = buildMappingCoverageSummary(
      softwareDetection.primary?.name ?? 'Connector',
      suggestedMappings,
      selectedMappings
    )
    const detectedSoftware = softwareDetection.primary
      ? {
          ...softwareDetection.primary,
          coverage: {
            ...(softwareDetection.primary.coverage ?? {}),
            ...coverageSummary,
            validationHints: [
              ...(softwareDetection.primary.coverage?.validationHints ?? []),
              ...coverageSummary.validationHints
            ]
          }
        }
      : null

    const connectorReadiness = buildConnectorReadinessSummary({
      suggestedMappings,
      selectedMappings,
      detectedSoftware: detectedSoftware
        ? {
            coverage: detectedSoftware.coverage,
            confidence: detectedSoftware.confidence
          }
        : null
    })
    const softwareCandidates = softwareDetection.candidates.map((candidate) => ({
      ...candidate,
      coverage: {
        ...(candidate.coverage ?? {}),
        ...buildMappingCoverageSummary(candidate.name, suggestedMappings, {}),
        validationHints: [
          ...(candidate.coverage?.validationHints ?? []),
          ...buildMappingCoverageSummary(candidate.name, suggestedMappings, {}).validationHints
        ]
      }
    }))
    const catalogTables = tables
      .sort((a, b) => this.toTableKey(a.schemaName, a.tableName).localeCompare(this.toTableKey(b.schemaName, b.tableName)))
      .map((table) => this.toCatalogTable(table))
    const dateDetection = this.detectCatalogDateMode(catalogTables)

    return {
      profileId,
      databaseName: detectedDatabaseName || params.databaseName,
      discoveredAt: new Date().toISOString(),
      serverVersion,
      totalTables,
      includedTables: catalogTables.length,
      sampledTables: sampleTargets.length,
      tables: catalogTables,
      suggestedMappings,
      selectedMappings,
      connectorReadiness,
      detectedSoftware,
      softwareCandidates,
      selectedSoftwareId: softwareOverrideId,
      detectedDateMode: dateDetection.mode,
      selectedDateMode: null,
      dateEvidence: dateDetection.evidence,
      connectorFingerprint
    }
  }

  private detectCatalogDateMode(tables: SchemaTableCatalogItem[]): {
    mode: SchemaDateMode
    evidence: string[]
  } {
    const shamsiTextPattern = /^(13|14)\d{2}[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])$/
    const shamsiNumericPattern = /^(13|14)\d{6}$/
    const gregorianTextPattern = /^(19|20)\d{2}[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])/i
    const fiscalPeriodPattern = /^\d{4}(0[1-9]|1[0-2])$/

    const scores: Record<SchemaDateMode, number> = {
      unknown: 0,
      gregorian: 0,
      shamsiText: 0,
      shamsiNumeric: 0,
      fiscalPeriod: 0,
      mixed: 0
    }

    const evidenceByMode: Record<SchemaDateMode, string[]> = {
      unknown: [],
      gregorian: [],
      shamsiText: [],
      shamsiNumeric: [],
      fiscalPeriod: [],
      mixed: []
    }

    for (const table of tables) {
      const tableRef = `${table.schemaName}.${table.tableName}`

      for (const column of table.columns) {
        const dataType = column.dataType.toLowerCase()
        const columnName = column.name.toLowerCase()
        const columnRef = `${tableRef}.${column.name}`
        const sampleValues = column.sampleValues.map((value) => value.trim()).filter(Boolean)

        if (dataType.includes('date') || dataType.includes('time')) {
          scores.gregorian += 2
          this.addDateEvidence(evidenceByMode, 'gregorian', `${columnRef} [${column.dataType}]`)
        }

        if (
          columnName.includes('fiscal') ||
          columnName.includes('period') ||
          columnName.includes('سال') ||
          columnName.includes('دوره')
        ) {
          scores.fiscalPeriod += 1
          this.addDateEvidence(evidenceByMode, 'fiscalPeriod', `${columnRef} [name]`)
        }

        for (const sampleValue of sampleValues) {
          if (shamsiTextPattern.test(sampleValue)) {
            scores.shamsiText += 3
            this.addDateEvidence(evidenceByMode, 'shamsiText', `${columnRef}=${sampleValue}`)
            continue
          }

          if (shamsiNumericPattern.test(sampleValue)) {
            scores.shamsiNumeric += 3
            this.addDateEvidence(evidenceByMode, 'shamsiNumeric', `${columnRef}=${sampleValue}`)
            continue
          }

          if (gregorianTextPattern.test(sampleValue)) {
            scores.gregorian += 2
            this.addDateEvidence(evidenceByMode, 'gregorian', `${columnRef}=${sampleValue}`)
            continue
          }

          if (fiscalPeriodPattern.test(sampleValue) && (columnName.includes('period') || columnName.includes('fiscal'))) {
            scores.fiscalPeriod += 2
            this.addDateEvidence(evidenceByMode, 'fiscalPeriod', `${columnRef}=${sampleValue}`)
          }
        }
      }
    }

    const rankedModes = (['gregorian', 'shamsiText', 'shamsiNumeric', 'fiscalPeriod'] as const)
      .map((mode) => ({
        mode,
        score: scores[mode]
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)

    if (rankedModes.length === 0) {
      return {
        mode: 'unknown',
        evidence: []
      }
    }

    if (rankedModes.length > 1 && rankedModes[0].score === rankedModes[1].score) {
      const mixedEvidence = [
        ...evidenceByMode[rankedModes[0].mode],
        ...evidenceByMode[rankedModes[1].mode]
      ].slice(0, MAX_DATE_EVIDENCE_ITEMS)

      return {
        mode: 'mixed',
        evidence: mixedEvidence
      }
    }

    const topMode = rankedModes[0].mode

    return {
      mode: topMode,
      evidence: evidenceByMode[topMode].slice(0, MAX_DATE_EVIDENCE_ITEMS)
    }
  }

  private addDateEvidence(
    evidenceByMode: Record<SchemaDateMode, string[]>,
    mode: SchemaDateMode,
    evidence: string
  ): void {
    const bucket = evidenceByMode[mode]

    if (bucket.includes(evidence)) {
      return
    }

    if (bucket.length >= MAX_DATE_EVIDENCE_ITEMS * 2) {
      return
    }

    bucket.push(evidence)
  }

  private toCatalogTable(table: TableRecord): SchemaTableCatalogItem {
    return {
      schemaName: table.schemaName,
      tableName: table.tableName,
      estimatedRowCount: table.estimatedRowCount,
      tags: [...table.tags],
      columns: table.columns.map((column) => ({ ...column })),
      foreignKeys: table.foreignKeys.map((foreignKey) => ({ ...foreignKey }))
    }
  }

  private detectTableTags(table: TableRecord): AccountingConceptKey[] {
    const searchSource = [
      table.schemaName,
      table.tableName,
      ...table.columns.map((column) => column.name)
    ]
      .join(' ')
      .toLowerCase()

    const tags: AccountingConceptKey[] = []

    for (const conceptKey of Object.keys(CONCEPT_PATTERNS) as AccountingConceptKey[]) {
      const patterns = CONCEPT_PATTERNS[conceptKey]
      if (patterns.some((pattern) => pattern.test(searchSource))) {
        tags.push(conceptKey)
      }
    }

    return tags
  }

  private pickSampleTables(tables: TableRecord[]): TableRecord[] {
    const ranked = [...tables]
      .map((table) => {
        const rowBonus = table.estimatedRowCount ? Math.min(8, Math.log10(table.estimatedRowCount + 1)) : 0
        return {
          table,
          score: table.tags.length * 10 + rowBonus
        }
      })
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score
        }

        const bRows = b.table.estimatedRowCount ?? -1
        const aRows = a.table.estimatedRowCount ?? -1
        if (bRows !== aRows) {
          return bRows - aRows
        }

        return this.toTableKey(a.table.schemaName, a.table.tableName).localeCompare(
          this.toTableKey(b.table.schemaName, b.table.tableName)
        )
      })

    return ranked.slice(0, MAX_SAMPLE_TABLES).map((entry) => entry.table)
  }

  private async fillSampleValues(table: TableRecord, executeSql: SqlExecutor): Promise<void> {
    const query = `SELECT TOP (${SAMPLE_ROW_LIMIT}) * FROM ${this.quoteSqlIdentifier(table.schemaName)}.${this.quoteSqlIdentifier(table.tableName)}`
    const rows = await executeSql(query)

    if (rows.length === 0) {
      return
    }

    const sampleMap = new Map<string, Set<string>>()
    for (const column of table.columns) {
      sampleMap.set(column.name.toLowerCase(), new Set<string>())
    }

    for (const row of rows) {
      for (const [columnName, rawValue] of Object.entries(row)) {
        const entry = sampleMap.get(columnName.toLowerCase())
        if (!entry || entry.size >= MAX_SAMPLE_VALUES_PER_COLUMN) {
          continue
        }

        const sampleValue = this.toSampleValue(rawValue)
        if (!sampleValue) {
          continue
        }

        entry.add(sampleValue)
      }
    }

    for (const column of table.columns) {
      const entry = sampleMap.get(column.name.toLowerCase())
      column.sampleValues = entry ? Array.from(entry) : []
    }
  }

  private buildSuggestedMappings(
    tables: TableRecord[],
    detectedSoftwareId: AccountingSoftwareId | null
  ): SchemaConceptSuggestions {
    const suggestions: SchemaConceptSuggestions = {}

    for (const conceptKey of Object.keys(CONCEPT_PATTERNS) as AccountingConceptKey[]) {
      const ranked = tables
        .map((table) => {
          const tableRef = `${table.schemaName}.${table.tableName}`
          const searchSource = [
            table.schemaName,
            table.tableName,
            ...table.columns.map((column) => column.name)
          ].join(' ')

          const patternHits = CONCEPT_PATTERNS[conceptKey].filter((pattern) => pattern.test(searchSource)).length
          const tagBonus = table.tags.includes(conceptKey) ? 2 : 0
          const softwareBoost = scoreTableForSoftwareConcept(detectedSoftwareId, conceptKey, tableRef)
          const score = patternHits * 4 + tagBonus + softwareBoost

          return {
            tableRef,
            score,
            rowCount: table.estimatedRowCount ?? -1
          }
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score
          }

          if (b.rowCount !== a.rowCount) {
            return b.rowCount - a.rowCount
          }

          return a.tableRef.localeCompare(b.tableRef)
        })

      if (ranked.length > 0) {
        suggestions[conceptKey] = ranked.slice(0, MAX_SUGGESTION_COUNT_PER_CONCEPT).map((entry) => entry.tableRef)
      }
    }

    return suggestions
  }

  private quoteSqlIdentifier(value: string): string {
    return `[${value.replace(/]/g, ']]')}]`
  }

  private toTableKey(schemaName: string, tableName: string): string {
    return `${schemaName.toLowerCase()}.${tableName.toLowerCase()}`
  }

  private toStringValue(value: unknown, fallback: string): string {
    if (typeof value === 'string') {
      return value.trim()
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value)
    }

    return fallback
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'bigint') {
      return Number(value)
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10)
      return Number.isFinite(parsed) ? parsed : null
    }

    return null
  }

  private toBooleanFlag(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'number') {
      return value === 1
    }

    if (typeof value === 'bigint') {
      return value === 1n
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      return normalized === '1' || normalized === 'true'
    }

    return false
  }

  private toSampleValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null
    }

    let text: string

    if (typeof value === 'string') {
      text = value.trim()
    } else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
      text = String(value)
    } else if (value instanceof Date) {
      text = value.toISOString()
    } else {
      try {
        text = JSON.stringify(value)
      } catch {
        text = String(value)
      }
    }

    if (!text) {
      return null
    }

    if (text.length > 90) {
      return `${text.slice(0, 87)}...`
    }

    return text
  }

  private buildCatalogCacheKey(
    profileId: string,
    databaseName: string,
    softwareOverrideId: AccountingSoftwareId | null
  ): string {
    return `${profileId.trim().toLowerCase()}::${databaseName.trim().toLowerCase()}::${softwareOverrideId ?? 'auto'}`
  }

  private normalizeSoftwareId(value: unknown): AccountingSoftwareId | null {
    if (value === 'sepidar' || value === 'mahak') {
      return value
    }

    return null
  }
}
