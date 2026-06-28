/**
 * Semantic Mapping Engine — Maps discovered schema to accounting concepts.
 *
 * S15.7: heuristicMapTables — regex/keyword-based table mapping
 * S15.8: buildLlmMappingPrompt — LLM prompt for ambiguous cases
 * S15.9: inferRelationships — discover FK/logical relationships
 * S15.10: detectEnums — detect enum-like columns from samples
 * S15.11: buildAdapter — construct a SchemaAdapter from mapping results
 */

import type {
  SchemaAdapter,
  SchemaTableMapping,
  SchemaColumnMapping,
  SchemaRelationship,
  SchemaEnumMapping,
  TableRef,
  ColumnRef,
  AdapterConfidence,
} from './schemaAdapter'
import type {
  RawSchemaInventory,
  RawTableInfo,
  RawColumnInfo,
  TableSample,
} from './schemaDiscovery'
import { makeColumnRef } from './schemaDiscovery'

// ─── S15.7: Heuristic table mapping ───

interface TableMatchCandidate {
  tableRef: TableRef
  score: number
  matchedConcept: string
}

const CONCEPT_KEYWORDS: Record<string, RegExp[]> = {
  salesInvoice: [
    /\binvoice\b/i, /\bsales?\b/i, /\bfactor[e]?\b/i, /فاکتور/i, /فاكتور/i,
    /\bsell\b/i, /\bsold\b/i,
  ],
  purchaseInvoice: [
    /\bpurchase\b/i, /\bbuy\b/i, /\bbill\b/i, /\bsupplier\b/i,
    /\bpom\b/i, /خرید/i, /خريد/i,
  ],
  inventoryReceipt: [
    /\binventory\b/i, /\breceipt\b/i, /\bstock\b/i, /\bwarehouse\b/i,
    /\binv\b/i, /انبار/i, /حواله/i,
  ],
  voucher: [
    /\bvoucher\b/i, /\bjournal\b/i, /\bentry\b/i, /\bsanad\b/i,
    /\bdocument\b/i, /سند/i, /\bacc\b/i,
    /journal.*entry/i,
  ],
  voucherItem: [
    /voucher.?item/i, /\bitem\b/i, /\bline\b/i, /\bdetail\b/i, /\barticle\b/i,
    /\bjournal_?line\b/i, /voucherline/i, /سند\s*ردیف/i,
    /journal.*line/i,
  ],
  account: [
    /\baccount\b/i, /\baccounts\b/i, /\bledger\b/i, /\bchart\b/i,
    /\bcoa\b/i, /\bcode\b/i, /حساب/i,
    /chart.*account/i,
  ],
  fiscalYear: [
    /fiscalyear/i, /\bfiscal/i, /\byear\b/i, /\bperiod\b/i,
    /سال/i, /\bdor[e]h\b/i, /دوره/i,
    /fiscal.*period/i,
  ],
  party: [
    /\bparty\b/i, /\bcustomer\b/i, /\bvendor\b/i, /\bpartner\b/i,
    /\bclient\b/i, /\bsupplier\b/i, /\bperson\b/i, /\bcontact\b/i,
    /شخص/i, /مشتری/i, /مشتري/i, /تأمین/i, /تامين/i,
  ],
  check: [
    /\bcheck\b/i, /\bcheque\b/i, /چک/i, /\bbank_?check\b/i,
  ],
  cashBalance: [
    /\bcash\b/i, /\bpety\b/i, /\bfund\b/i, /\bcashbox\b/i,
    /صندوق/i, /\bcash_?balance\b/i,
  ],
  bankBalance: [
    /\bbank\b/i, /\bbank_?account\b/i, /\bbank_?balance\b/i,
    /بانک/i, /بانك/i,
  ],
  costCenter: [
    /\bcost\s*center\b/i, /\bcost_center\b/i, /\bcostcenter\b/i,
    /مرکز\s*هزینه/i, /مركز\s*هزينه/i,
  ],
  project: [
    /\bproject\b/i, /\bprojects\b/i, /پروژه/i, /پروژه/i,
  ],
}

const COLUMN_KEYWORDS: Record<string, RegExp[]> = {
  idColumn: [/id$/i, /\bid\b/i, /\bref\b/i, /\bpk\b/i],
  dateColumn: [/date/i, /\btime\b/i, /\btarikh\b/i, /تاریخ/i],
  netAmountColumn: [/\bnet\b/i, /\bamount\b/i, /\btotal\b/i, /\bprice\b/i, /\bvalue\b/i, /\bnet_?amount\b/i, /مبلغ/i],
  grossAmountColumn: [/\bgross\b/i, /\bsubtotal\b/i, /\bbruto\b/i],
  taxAmountColumn: [/\btax\b/i, /\bvat\b/i, /مالیات/i],
  debitColumn: [/\bdebit\b/i, /\bdeb\b/i, /\bdbt\b/i, /بده/i, /بدهکار/i],
  creditColumn: [/\bcredit\b/i, /\bcrd\b/i, /\bcrt\b/i, /بستان/i, /بستانکار/i],
  numberColumn: [/number/i, /\bno\b/i, /\bnum\b/i, /شماره/i],
  typeColumn: [/type/i, /\bkind\b/i, /\bcategory\b/i, /نوع/i],
  descriptionColumn: [/description/i, /\bdesc\b/i, /\bnote\b/i, /\bcomment\b/i, /\bremark\b/i, /شرح/i, /توضیح/i],
  codeColumn: [/code/i, /\bsymbol\b/i, /کد/i, /كد/i],
  titleColumn: [/title/i, /name/i, /\blabel\b/i, /عنوان/i, /نام/i],
  isReturnColumn: [/\breturn\b/i, /\bis_?return\b/i, /مرجوع/i, /برگشتی/i],
  fiscalYearRefColumn: [/fiscalyear/i, /yearref/i, /periodref/i, /سال/i],
  partyRefColumn: [/party/i, /customer/i, /vendor/i, /partner/i, /person_?ref/i],
  accountRefColumn: [/accountref/i, /accountid/i, /accref/i, /account_?ref/i],
  voucherRefColumn: [/voucher_?ref/i, /voucher_?id/i, /doc_?ref/i, /sanad_?ref/i, /entry_?ref/i],
  statusColumn: [/\bstatus\b/i, /\bstate\b/i, /\bcondition\b/i, /وضعیت/i],
  directionColumn: [/\bdirection\b/i, /\bdir\b/i, /\bincome\b/i, /\boutgo\b/i, /جهت/i],
  dueDateColumn: [/\bdue\b/i, /\bdue_?date\b/i, /\bmaturity\b/i, /سررسید/i],
  amountColumn: [/\bamount\b/i, /\bvalue\b/i, /\bbalance\b/i, /مبلغ/i, /مانده/i],
  totalPriceColumn: [/\btotal\b/i, /\btotal_?price\b/i, /\bsum\b/i, /مبلغ\s*کل/i],
}

export interface HeuristicMappingResult {
  tables: SchemaTableMapping
  columns: SchemaColumnMapping
  confidence: AdapterConfidence
  unmatched: string[]
}

export function heuristicMapTables(inventory: RawSchemaInventory): HeuristicMappingResult {
  const tables = filterRelevantTablesInternal(inventory)
  const tableMapping: SchemaTableMapping = {}
  const columnMapping: SchemaColumnMapping = {}
  const unmatched: string[] = []

  for (const [conceptKey, patterns] of Object.entries(CONCEPT_KEYWORDS)) {
    const candidates: TableMatchCandidate[] = []

    for (const table of tables) {
      const searchSource = table.tableRef.schema + ' ' + table.tableRef.table
      const score = patterns.reduce((acc, p) => acc + (p.test(searchSource) ? 1 : 0), 0)
      if (score > 0) {
        candidates.push({
          tableRef: table.tableRef,
          score: score + Math.log10((table.estimatedRowCount ?? 1) + 1),
          matchedConcept: conceptKey,
        })
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    if (candidates.length > 0) {
      const best = candidates[0]
      ;(tableMapping as Record<string, TableRef>)[conceptKey] = best.tableRef

      // Map columns for this table
      const tableInfo = tables.find(
        (t) => t.tableRef.schema === best.tableRef.schema && t.tableRef.table === best.tableRef.table
      )
      if (tableInfo) {
        const colMapping = mapColumnsForConcept(conceptKey, tableInfo)
        if (colMapping) {
          ;(columnMapping as Record<string, unknown>)[conceptKey] = colMapping
        }
      }
    }
  }

  // Find unmatched relevant tables
  const matchedRefs = new Set(
    Object.values(tableMapping).map((r) => r.schema.toLowerCase() + '.' + r.table.toLowerCase())
  )
  for (const table of tables) {
    const key = table.tableRef.schema.toLowerCase() + '.' + table.tableRef.table.toLowerCase()
    if (!matchedRefs.has(key)) {
      unmatched.push(table.tableRef.schema + '.' + table.tableRef.table)
    }
  }

  const confidence = determineConfidence(tableMapping)

  return { tables: tableMapping, columns: columnMapping, confidence, unmatched }
}

function filterRelevantTablesInternal(inventory: RawSchemaInventory): RawTableInfo[] {
  return inventory.tables.filter((t) => {
    if (t.estimatedRowCount === 0) return false
    if (/^sys$/i.test(t.tableRef.schema)) return false
    return true
  })
}

function mapColumnsForConcept(
  conceptKey: string,
  table: RawTableInfo
): Record<string, ColumnRef> | null {
  const result: Record<string, ColumnRef> = {}

  // Determine which column patterns to try based on concept
  const columnKeys = getConceptColumnKeys(conceptKey)

  for (const colKey of columnKeys) {
    const patterns = COLUMN_KEYWORDS[colKey]
    if (!patterns) continue

    let bestCol: RawColumnInfo | null = null
    let bestScore = 0

    for (const col of table.columns) {
      const score = patterns.reduce((acc, p) => acc + (p.test(col.name) ? 1 : 0), 0)
      if (score > bestScore) {
        bestScore = score
        bestCol = col
      }
    }

    if (bestCol) {
      result[colKey] = makeColumnRef(table.tableRef, bestCol.name)
    }
  }

  // Also check for PK column
  const pkCol = table.columns.find((c) => c.isPrimaryKey)
  if (pkCol && !result['idColumn']) {
    result['idColumn'] = makeColumnRef(table.tableRef, pkCol.name)
  }

  return Object.keys(result).length > 0 ? result : null
}

function getConceptColumnKeys(conceptKey: string): string[] {
  const map: Record<string, string[]> = {
    salesInvoice: ['idColumn', 'dateColumn', 'netAmountColumn', 'grossAmountColumn', 'taxAmountColumn', 'fiscalYearRefColumn', 'partyRefColumn'],
    purchaseInvoice: ['idColumn', 'dateColumn', 'netAmountColumn', 'fiscalYearRefColumn', 'partyRefColumn'],
    inventoryReceipt: ['idColumn', 'dateColumn', 'totalPriceColumn', 'isReturnColumn', 'fiscalYearRefColumn'],
    voucher: ['idColumn', 'numberColumn', 'dateColumn', 'typeColumn', 'descriptionColumn', 'fiscalYearRefColumn'],
    voucherItem: ['idColumn', 'voucherRefColumn', 'accountRefColumn', 'debitColumn', 'creditColumn', 'descriptionColumn', 'partyRefColumn'],
    account: ['idColumn', 'codeColumn', 'titleColumn', 'typeColumn'],
    fiscalYear: ['idColumn', 'titleColumn'],
    party: ['idColumn', 'titleColumn'],
    check: ['idColumn', 'numberColumn', 'dueDateColumn', 'amountColumn', 'statusColumn', 'directionColumn', 'partyRefColumn'],
    cashBalance: ['idColumn', 'amountColumn'],
    bankBalance: ['idColumn', 'amountColumn'],
    costCenter: ['idColumn', 'codeColumn', 'titleColumn'],
    project: ['idColumn', 'codeColumn', 'titleColumn'],
  }
  return map[conceptKey] ?? []
}

function determineConfidence(tables: SchemaTableMapping): AdapterConfidence {
  const coreConcepts = ['voucher', 'voucherItem', 'account', 'fiscalYear']
  const matched = coreConcepts.filter((c) => (tables as Record<string, unknown>)[c]).length
  if (matched >= 4) return 'high'
  if (matched >= 2) return 'medium'
  return 'low'
}

// ─── S15.8: LLM mapping prompt builder ───

export interface LlmMappingPromptInput {
  inventory: RawSchemaInventory
  heuristicResult: HeuristicMappingResult
  samples?: TableSample[]
}

export function buildLlmMappingPrompt(input: LlmMappingPromptInput): string {
  const { inventory, heuristicResult, samples } = input

  const tableList = inventory.tables
    .map((t) => {
      const cols = t.columns.map((c) => c.name).join(', ')
      const fks = t.foreignKeys.map((f) => `${f.column}→${f.referencedTable.schema}.${f.referencedTable.table}.${f.referencedColumn}`).join('; ')
      return `- ${t.tableRef.schema}.${t.tableRef.table} (${t.estimatedRowCount ?? '?'} rows): ${cols}${fks ? ' | FKs: ' + fks : ''}`
    })
    .join('\n')

  const matchedTables = Object.entries(heuristicResult.tables)
    .map(([concept, ref]) => `- ${concept}: ${ref.schema}.${ref.table}`)
    .join('\n')

  const unmatchedList = heuristicResult.unmatched.length > 0
    ? '\nUnmatched tables:\n' + heuristicResult.unmatched.map((t) => `- ${t}`).join('\n')
    : ''

  const sampleInfo = samples && samples.length > 0
    ? '\nSample data:\n' + samples.map((s) => {
        const tableRef = s.tableRef.schema + '.' + s.tableRef.table
        const rows = s.rows.map((r) => JSON.stringify(r)).join(', ')
        return `- ${tableRef}: ${rows}`
      }).join('\n')
    : ''

  return `You are a database schema analyst. Map the following SQL Server tables to accounting concepts.

Available concepts: salesInvoice, purchaseInvoice, inventoryReceipt, voucher, voucherItem, account, fiscalYear, party, check, cashBalance, bankBalance, costCenter, project

Tables discovered:
${tableList}

Heuristic mapping (preliminary):
${matchedTables}${unmatchedList}${sampleInfo}

For each concept, provide:
1. The best matching table (schema.table)
2. Column mappings for: id, date, amount, debit, credit, type, description, code, title, fiscalYearRef, partyRef, accountRef, voucherRef
3. Confidence: high/medium/low

Respond in JSON format:
{
  "tables": { "conceptName": "schema.table", ... },
  "columns": { "conceptName": { "field": "columnName", ... }, ... },
  "confidence": "high|medium|low",
  "notes": "any observations"
}`
}

// ─── S15.9: Relationship inference ───

export function inferRelationships(
  inventory: RawSchemaInventory,
  tableMapping: SchemaTableMapping
): SchemaRelationship[] {
  const relationships: SchemaRelationship[] = []

  // Add physical FKs from inventory
  for (const table of inventory.tables) {
    for (const fk of table.foreignKeys) {
      relationships.push({
        fromTable: table.tableRef,
        fromColumn: fk.column,
        toTable: fk.referencedTable,
        toColumn: fk.referencedColumn,
        type: 'fk',
      })
    }
  }

  // Infer logical relationships based on naming conventions
  const mappedTables = Object.entries(tableMapping)
  for (const [concept, ref] of mappedTables) {
    // Look for columns that might reference other mapped tables
    const tableInfo = inventory.tables.find(
      (t) => t.tableRef.schema === ref.schema && t.tableRef.table === ref.table
    )
    if (!tableInfo) continue

    for (const col of tableInfo.columns) {
      const colLower = col.name.toLowerCase()

      // Check if this column references a fiscal year table
      if (colLower.includes('fiscalyear') || colLower.includes('yearref') || colLower.includes('periodref')) {
        if (tableMapping.fiscalYear) {
          const fyTable = tableMapping.fiscalYear
          const fyInfo = inventory.tables.find(
            (t) => t.tableRef.schema === fyTable.schema && t.tableRef.table === fyTable.table
          )
          const fyPk = fyInfo?.columns.find((c) => c.isPrimaryKey)
          if (fyPk) {
            relationships.push({
              fromTable: ref,
              fromColumn: col.name,
              toTable: fyTable,
              toColumn: fyPk.name,
              type: 'logical',
            })
          }
        }
      }

      // Check if this column references a party/partner table
      if (colLower.includes('party') || colLower.includes('partner') || colLower.includes('customer') || colLower.includes('vendor')) {
        if (tableMapping.party && concept !== 'party') {
          const partyTable = tableMapping.party
          const partyInfo = inventory.tables.find(
            (t) => t.tableRef.schema === partyTable.schema && t.tableRef.table === partyTable.table
          )
          const partyPk = partyInfo?.columns.find((c) => c.isPrimaryKey)
          if (partyPk) {
            relationships.push({
              fromTable: ref,
              fromColumn: col.name,
              toTable: partyTable,
              toColumn: partyPk.name,
              type: 'logical',
            })
          }
        }
      }

      // Check if this column references an account table
      if (colLower.includes('account') && colLower.includes('ref') || colLower.includes('accountid')) {
        if (tableMapping.account && concept !== 'account') {
          const accTable = tableMapping.account
          const accInfo = inventory.tables.find(
            (t) => t.tableRef.schema === accTable.schema && t.tableRef.table === accTable.table
          )
          const accPk = accInfo?.columns.find((c) => c.isPrimaryKey)
          if (accPk) {
            relationships.push({
              fromTable: ref,
              fromColumn: col.name,
              toTable: accTable,
              toColumn: accPk.name,
              type: 'logical',
            })
          }
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  return relationships.filter((r) => {
    if (!r.fromTable || !r.toTable) return false
    const key = r.fromTable.schema + '.' + r.fromTable.table + '.' + r.fromColumn + '->' +
      r.toTable.schema + '.' + r.toTable.table + '.' + r.toColumn
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── S15.10: Enum detection ───

export function detectEnums(
  inventory: RawSchemaInventory,
  tableMapping: SchemaTableMapping,
  samples?: TableSample[]
): SchemaEnumMapping {
  const enums: SchemaEnumMapping = {}

  // Detect voucher type enum
  if (tableMapping.voucher) {
    const voucherTable = inventory.tables.find(
      (t) => t.tableRef.schema === tableMapping.voucher!.schema &&
            t.tableRef.table === tableMapping.voucher!.table
    )
    const typeCol = voucherTable?.columns.find(
      (c) => /\btype\b/i.test(c.name) || /\bkind\b/i.test(c.name)
    )

    if (typeCol) {
      // Try to infer from sample data
      const sample = samples?.find(
        (s) => s.tableRef.schema === tableMapping.voucher!.schema &&
              s.tableRef.table === tableMapping.voucher!.table
      )

      if (sample) {
        const typeValues = sample.rows
          .map((r) => r[typeCol.name])
          .filter((v) => v !== null && v !== undefined)
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v))

        if (typeValues.length > 0) {
          const uniqueValues = [...new Set(typeValues)].sort((a, b) => a - b)
          enums.voucherType = {
            operational: uniqueValues.filter((v) => v <= 2),
            tempClosing: uniqueValues.filter((v) => v === 3),
            closing: uniqueValues.filter((v) => v === 4),
            opening: uniqueValues.filter((v) => v === 5),
          }
        }
      }

      // Default fallback if no samples
      if (!enums.voucherType) {
        enums.voucherType = {
          operational: [1, 2],
          tempClosing: [3],
          closing: [4],
          opening: [5],
        }
      }
    }
  }

  // Detect inventory return type enum
  if (tableMapping.inventoryReceipt) {
    const invTable = inventory.tables.find(
      (t) => t.tableRef.schema === tableMapping.inventoryReceipt!.schema &&
            t.tableRef.table === tableMapping.inventoryReceipt!.table
    )
    const returnCol = invTable?.columns.find(
      (c) => /\breturn\b/i.test(c.name) || /\bis_?return\b/i.test(c.name)
    )

    if (returnCol) {
      enums.inventoryReturnType = { normal: 0, return: 1 }
    }
  }

  return enums
}

// ─── S15.11: buildAdapter — construct SchemaAdapter from mapping ───

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

const FIELD_TO_COLUMN_KEY: Record<string, string> = {
  net_amount: 'netAmountColumn',
  gross_amount: 'grossAmountColumn',
  tax_amount: 'taxAmountColumn',
  date: 'dateColumn',
  fiscal_year_id: 'fiscalYearRefColumn',
  party_id: 'partyRefColumn',
  account_id: 'accountRefColumn',
  voucher_id: 'voucherRefColumn',
  voucher_type: 'typeColumn',
  debit: 'debitColumn',
  credit: 'creditColumn',
  code: 'codeColumn',
  title: 'titleColumn',
  name: 'titleColumn',
  description: 'descriptionColumn',
  number: 'numberColumn',
  primary_key: 'idColumn',
  is_return: 'isReturnColumn',
  total_price: 'totalPriceColumn',
  status: 'statusColumn',
  direction: 'directionColumn',
  due_date: 'dueDateColumn',
  amount: 'amountColumn',
}

function translateField(field: string): string {
  return FIELD_TO_COLUMN_KEY[field] ?? field
}

export interface BuildAdapterInput {
  softwareId: string
  softwareName: string
  tables: SchemaTableMapping
  columns: SchemaColumnMapping
  relationships: SchemaRelationship[]
  enums: SchemaEnumMapping
  confidence: AdapterConfidence
}

export function buildAdapter(input: BuildAdapterInput): SchemaAdapter {
  return new DiscoveredAdapter(input)
}

class DiscoveredAdapter implements SchemaAdapter {
  readonly softwareId: string
  readonly softwareName: string
  readonly discoveryMethod = 'auto' as const
  readonly confidence: AdapterConfidence
  readonly discoveredAt: string
  readonly tables: SchemaTableMapping
  readonly columns: SchemaColumnMapping
  readonly relationships: SchemaRelationship[]
  readonly enums: SchemaEnumMapping

  constructor(input: BuildAdapterInput) {
    this.softwareId = input.softwareId
    this.softwareName = input.softwareName
    this.confidence = input.confidence
    this.discoveredAt = new Date().toISOString()
    this.tables = input.tables
    this.columns = input.columns
    this.relationships = input.relationships
    this.enums = input.enums
  }

  resolveTable(concept: string): string {
    const key = snakeToCamel(concept)
    const mapping = (this.tables as Record<string, TableRef>)[key] ?? (this.tables as Record<string, TableRef>)[concept]
    if (!mapping) {
      throw new Error('Unknown concept: ' + concept)
    }
    return mapping.schema + '.' + mapping.table
  }

  resolveColumn(concept: string, field: string): string {
    const key = snakeToCamel(concept)
    const conceptCols = (this.columns as Record<string, Record<string, ColumnRef>>)[key] ?? (this.columns as Record<string, Record<string, ColumnRef>>)[concept]
    if (!conceptCols) {
      throw new Error('No column mapping for concept: ' + concept)
    }
    const colRef = conceptCols[field] ?? conceptCols[translateField(field)]
    if (!colRef) {
      throw new Error('Unknown field ' + field + ' for concept ' + concept)
    }
    return colRef.column
  }

  getFiscalYearJoin(_sourceAlias: string, sourceColumn: string): { table: string; alias: string; on: { sourceColumn: string; targetColumn: string }; type: 'inner' } {
    if (!this.tables.fiscalYear) {
      throw new Error('No fiscal year table mapped')
    }
    const fy = this.tables.fiscalYear
    const fyPk = this.columns.fiscalYear?.idColumn?.column ?? 'Id'
    return {
      table: fy.schema + '.' + fy.table,
      alias: 'fy',
      on: { sourceColumn, targetColumn: fyPk },
      type: 'inner',
    }
  }

  getVoucherTypeFilter(excludeClosing: boolean): string {
    if (!this.enums.voucherType) {
      return '1=1'
    }
    if (excludeClosing) {
      const excluded = [
        ...(this.enums.voucherType.closing ?? []),
        ...(this.enums.voucherType.tempClosing ?? []),
        ...(this.enums.voucherType.opening ?? []),
      ]
      if (excluded.length === 0) return '1=1'
      const typeCol = this.columns.voucher?.typeColumn?.column ?? 'Type'
      return 'v.' + typeCol + ' NOT IN (' + excluded.join(', ') + ')'
    }
    return '1=1'
  }

  getAccountClassification(category: string): string {
    // Default: use code prefix (1=assets, 2=liabilities, 3=equity, 4=revenue, 5=expenses)
    const prefixMap: Record<string, string> = {
      asset: '1',
      liability: '2',
      equity: '3',
      revenue: '4',
      expense: '5',
    }
    const prefix = prefixMap[category]
    if (!prefix) return '1=1'
    const codeCol = this.columns.account?.codeColumn?.column ?? 'Code'
    return "SUBSTRING(a." + codeCol + ", 1, 1) = '" + prefix + "'"
  }

  getPersianTextFoldExpression(column: string): string {
    return column + ' COLLATE Arabic_CI_AI'
  }

  buildConnectionString(config: { server: string; port: number; database: string; user: string; password: string; encrypt?: boolean; trustServerCertificate?: boolean }): string {
    const parts = [
      'Server=' + config.server + ',' + config.port,
      'Database=' + config.database,
      'User Id=' + config.user,
      'Password=' + config.password,
    ]
    if (config.encrypt !== false) {
      parts.push('Encrypt=True')
    }
    if (config.trustServerCertificate) {
      parts.push('TrustServerCertificate=True')
    }
    return parts.join(';')
  }

  getFiscalYearColumn(concept: string): string {
    return this.resolveColumn(concept, 'fiscalYearRefColumn')
  }

  getPrimaryKeyColumn(concept: string): string {
    return this.resolveColumn(concept, 'idColumn')
  }
}
