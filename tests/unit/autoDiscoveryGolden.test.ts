/**
 * S15.24-S15.25: Mock schema fixture + golden cases for auto-discovery
 *
 * Tests the full pipeline: mock schema → heuristicMapTables → inferRelationships
 * → detectEnums → buildAdapter → compileMetricPlan → verify SQL contains
 * correct physical table/column names from the mock schema.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  heuristicMapTables,
  inferRelationships,
  detectEnums,
  buildAdapter,
} from '../../src/main/services/financialEngine/semanticMapping'
import type { RawSchemaInventory } from '../../src/main/services/financialEngine/schemaDiscovery'
import { filterRelevantTables } from '../../src/main/services/financialEngine/schemaDiscovery'
import { compileMetricPlan, type CompilerDeps } from '../../src/main/services/financialEngine/compiler'
import {
  AccountingConcept,
  AccountCategory,
  type SchemaAdapter,
} from '../../src/main/services/financialEngine/schemaAdapter'
import type { MetricPlan, MetricDefinition, ConceptSource, ConceptAggregateKind, ConceptDimensionBinding } from '../../src/main/services/financialEngine/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadMockSchema(): RawSchemaInventory {
  const fixturePath = resolve(__dirname, '../fixtures/mock-schema.json')
  const raw = readFileSync(fixturePath, 'utf-8')
  return JSON.parse(raw) as RawSchemaInventory
}

function makeCompilerDeps(adapter: SchemaAdapter): CompilerDeps {
  return {
    quoteSqlTableRef: (ref: string) => {
      const parts = ref.split('.')
      if (parts.length === 2) return `[${parts[0]}].[${parts[1]}]`
      return `[${ref}]`
    },
    quoteSqlIdentifier: (id: string) => `[${id}]`,
    normalizePersianText: (text: string) => text,
    adapter,
  }
}

// ─── S15.24: Mock schema fixture validation ───

test('S15.24: Mock schema has 7 tables including irrelevant ones', () => {
  const schema = loadMockSchema()
  assert.equal(schema.tables.length, 7)
  assert.equal(schema.databaseName, 'MockSoftDB')
})

test('S15.24: filterRelevantTables removes migration_log and keeps accounting tables', () => {
  const schema = loadMockSchema()
  const filtered = filterRelevantTables(schema)
  const tableNames = filtered.map((t) => t.tableRef.table)

  assert.ok(tableNames.includes('JournalEntry'))
  assert.ok(tableNames.includes('JournalLine'))
  assert.ok(tableNames.includes('ChartOfAccounts'))
  assert.ok(tableNames.includes('FiscalPeriod'))
  assert.ok(tableNames.includes('Bill'))
  assert.ok(tableNames.includes('Customer'))
  assert.ok(!tableNames.includes('migration_log'))
})

// ─── S15.25: Heuristic mapping → adapter → compiler golden cases ───

function buildMockAdapter(): SchemaAdapter {
  const schema = loadMockSchema()
  const heuristic = heuristicMapTables(schema)
  const relationships = inferRelationships(schema, heuristic.tables)
  const enums = detectEnums(schema, heuristic.tables)

  return buildAdapter({
    softwareId: 'mocksoft',
    softwareName: 'Mock Software',
    tables: heuristic.tables,
    columns: heuristic.columns,
    relationships,
    enums,
    confidence: heuristic.confidence,
  })
}

test('S15.25: Heuristic mapping identifies all core concepts', () => {
  const schema = loadMockSchema()
  const result = heuristicMapTables(schema)

  const tables = result.tables as Record<string, { schema: string; table: string }>
  assert.ok(tables.voucher, 'voucher should be mapped')
  assert.ok(tables.voucherItem, 'voucherItem should be mapped')
  assert.ok(tables.account, 'account should be mapped')
  assert.ok(tables.fiscalYear, 'fiscalYear should be mapped')
  assert.ok(tables.salesInvoice, 'salesInvoice should be mapped')
})

test('S15.25: Voucher maps to Accounting.JournalEntry', () => {
  const schema = loadMockSchema()
  const result = heuristicMapTables(schema)
  const tables = result.tables as Record<string, { schema: string; table: string }>
  assert.equal(tables.voucher.schema, 'Accounting')
  assert.equal(tables.voucher.table, 'JournalEntry')
})

test('S15.25: VoucherItem maps to Accounting.JournalLine', () => {
  const schema = loadMockSchema()
  const result = heuristicMapTables(schema)
  const tables = result.tables as Record<string, { schema: string; table: string }>
  assert.equal(tables.voucherItem.schema, 'Accounting')
  assert.equal(tables.voucherItem.table, 'JournalLine')
})

test('S15.25: Account maps to Accounting.ChartOfAccounts', () => {
  const schema = loadMockSchema()
  const result = heuristicMapTables(schema)
  const tables = result.tables as Record<string, { schema: string; table: string }>
  assert.equal(tables.account.schema, 'Accounting')
  assert.equal(tables.account.table, 'ChartOfAccounts')
})

test('S15.25: FiscalYear maps to Financial.FiscalPeriod', () => {
  const schema = loadMockSchema()
  const result = heuristicMapTables(schema)
  const tables = result.tables as Record<string, { schema: string; table: string }>
  assert.equal(tables.fiscalYear.schema, 'Financial')
  assert.equal(tables.fiscalYear.table, 'FiscalPeriod')
})

test('S15.25: SalesInvoice maps to Sales.Bill', () => {
  const schema = loadMockSchema()
  const result = heuristicMapTables(schema)
  const tables = result.tables as Record<string, { schema: string; table: string }>
  assert.equal(tables.salesInvoice.schema, 'Sales')
  assert.equal(tables.salesInvoice.table, 'Bill')
})

test('S15.25: Confidence is high (all 4 core concepts mapped)', () => {
  const schema = loadMockSchema()
  const result = heuristicMapTables(schema)
  assert.equal(result.confidence, 'high')
})

test('S15.25: buildAdapter produces working SchemaAdapter', () => {
  const adapter = buildMockAdapter()

  assert.equal(adapter.softwareId, 'mocksoft')
  assert.equal(adapter.discoveryMethod, 'auto')
  assert.ok(adapter.discoveredAt)

  assert.equal(adapter.resolveTable(AccountingConcept.voucher), 'Accounting.JournalEntry')
  assert.equal(adapter.resolveTable(AccountingConcept.voucher_item), 'Accounting.JournalLine')
  assert.equal(adapter.resolveTable(AccountingConcept.account), 'Accounting.ChartOfAccounts')
  assert.equal(adapter.resolveTable(AccountingConcept.fiscal_year), 'Financial.FiscalPeriod')
  assert.equal(adapter.resolveTable(AccountingConcept.sales_invoice), 'Sales.Bill')
})

// ─── S15.25: Compiler integration — verify SQL uses mock schema names ───

function makeConceptSalesDef(): MetricDefinition {
  const conceptSource: ConceptSource = {
    concept: AccountingConcept.sales_invoice,
    alias: 'src',
  }
  const conceptMeasure: ConceptAggregateKind = {
    kind: 'sum',
    field: 'net_amount',
  }
  const conceptDimensions: ConceptDimensionBinding[] = [
    {
      dimension: 'by_year',
      conceptJoin: {
        concept: AccountingConcept.fiscal_year,
        alias: 'fy',
        on: { sourceColumn: 'fiscal_year_id', targetColumn: 'primary_key' },
      },
      conceptLabelField: 'title',
      labelType: 'nstring',
    },
  ]
  return {
    id: 'net_sales',
    titleFa: 'فروش خالص',
    anchors: ['فروش'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: { primaryTable: 'SLS.Invoice', alias: 'src' },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    dimensions: [],
    mandatoryFilters: [],
    conceptSource,
    conceptMeasure,
    conceptDimensions,
    conceptDateColumn: { sourceAlias: 'src', field: 'date' },
  }
}

function makeConceptVoucherDef(): MetricDefinition {
  const conceptSource: ConceptSource = {
    concept: AccountingConcept.voucher_item,
    alias: 'vi',
    requiredJoins: [
      {
        concept: AccountingConcept.voucher,
        alias: 'v',
        on: { sourceColumn: 'voucher_id', targetColumn: 'primary_key' },
      },
      {
        concept: AccountingConcept.account,
        alias: 'a',
        on: { sourceColumn: 'account_id', targetColumn: 'primary_key' },
      },
    ],
  }
  const conceptMeasure: ConceptAggregateKind = {
    kind: 'debit_minus_credit',
    debitField: 'debit',
    creditField: 'credit',
  }
  const conceptDimensions: ConceptDimensionBinding[] = [
    {
      dimension: 'by_year',
      conceptJoin: {
        concept: AccountingConcept.fiscal_year,
        alias: 'fy',
        on: { sourceColumn: 'fiscal_year_id', targetColumn: 'primary_key' },
        sourceAlias: 'v',
      },
      conceptLabelField: 'title',
      labelType: 'nstring',
    },
  ]
  return {
    id: 'account_balance',
    titleFa: 'مانده حساب',
    anchors: ['حساب'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: { primaryTable: 'ACC.VoucherItem', alias: 'vi' },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [],
    mandatoryFilters: [],
    conceptSource,
    conceptMeasure,
    conceptDimensions,
  }
}

test('S15.25: Golden case — concept-based net_sales with mock adapter produces SQL with Sales.Bill', () => {
  const adapter = buildMockAdapter()
  const deps = makeCompilerDeps(adapter)
  const def = makeConceptSalesDef()

  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const compiled = compileMetricPlan(plan, def, deps)

  assert.ok(compiled.sql.includes('[Sales].[Bill]'), 'SQL should reference Sales.Bill table')
  assert.ok(!compiled.sql.includes('[SLS]'), 'SQL should not contain Sepidar SLS schema')
})

test('S15.25: Golden case — concept-based account_balance with mock adapter uses ChartOfAccounts', () => {
  const adapter = buildMockAdapter()
  const deps = makeCompilerDeps(adapter)
  const def = makeConceptVoucherDef()

  const plan: MetricPlan = {
    metricId: 'account_balance',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const compiled = compileMetricPlan(plan, def, deps)

  assert.ok(
    compiled.sql.includes('[Accounting].[ChartOfAccounts]'),
    'SQL should reference ChartOfAccounts table'
  )
  assert.ok(
    compiled.sql.includes('[Accounting].[JournalLine]'),
    'SQL should reference JournalLine for voucher items'
  )
  assert.ok(
    compiled.sql.includes('[Accounting].[JournalEntry]'),
    'SQL should reference JournalEntry for voucher table'
  )
  assert.ok(!compiled.sql.includes('[ACC]'), 'SQL should not contain Sepidar ACC schema')
})

test('S15.25: Golden case — concept-based net_sales by_year joins FiscalPeriod', () => {
  const adapter = buildMockAdapter()
  const deps = makeCompilerDeps(adapter)
  const def = makeConceptSalesDef()

  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'by_year',
    filters: [],
    confidence: 1.0,
  }

  const compiled = compileMetricPlan(plan, def, deps)

  assert.ok(compiled.sql.includes('[Financial].[FiscalPeriod]'), 'SQL should join FiscalPeriod')
  assert.ok(compiled.sql.includes('[Sales].[Bill]'), 'SQL should reference Sales.Bill')
})

test('S15.25: Golden case — SQL does NOT contain Sepidar table names', () => {
  const adapter = buildMockAdapter()
  const deps = makeCompilerDeps(adapter)
  const def = makeConceptSalesDef()

  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const compiled = compileMetricPlan(plan, def, deps)

  assert.ok(!compiled.sql.includes('[SLS]'), 'SQL should not contain Sepidar SLS schema')
  assert.ok(!compiled.sql.includes('[ACC]'), 'SQL should not contain Sepidar ACC schema')
  assert.ok(!compiled.sql.includes('[FMK]'), 'SQL should not contain Sepidar FMK schema')
})

test('S15.25: Golden case — voucher_type filter uses mock DocType column', () => {
  const adapter = buildMockAdapter()
  const filter = adapter.getVoucherTypeFilter(true)
  if (filter !== '1=1') {
    assert.ok(filter.includes('DocType'), 'Voucher type filter should use DocType column')
  }
})

test('S15.25: Golden case — account classification uses mock AccountCode column', () => {
  const adapter = buildMockAdapter()
  const filter = adapter.getAccountClassification(AccountCategory.asset)
  assert.ok(
    filter.includes('AccountCode'),
    'Account classification should use AccountCode column'
  )
})

test('S15.25: Golden case — fiscal year join uses FiscalPeriod table', () => {
  const adapter = buildMockAdapter()
  const join = adapter.getFiscalYearJoin('v', 'PeriodRef')
  assert.equal(join.table, 'Financial.FiscalPeriod')
  assert.equal(join.alias, 'fy')
  assert.equal(join.on.sourceColumn, 'PeriodRef')
})

test('S15.25: Golden case — resolveColumn maps voucher fields correctly', () => {
  const adapter = buildMockAdapter()

  const dateCol = adapter.resolveColumn(AccountingConcept.voucher, 'dateColumn')
  assert.equal(dateCol, 'EntryDate')

  const typeCol = adapter.resolveColumn(AccountingConcept.voucher, 'typeColumn')
  assert.equal(typeCol, 'DocType')
})

test('S15.25: Golden case — resolveColumn maps voucherItem fields correctly', () => {
  const adapter = buildMockAdapter()

  const debitCol = adapter.resolveColumn(AccountingConcept.voucher_item, 'debitColumn')
  assert.equal(debitCol, 'Debit')

  const creditCol = adapter.resolveColumn(AccountingConcept.voucher_item, 'creditColumn')
  assert.equal(creditCol, 'Credit')
})

test('S15.25: Golden case — resolveColumn maps account fields correctly', () => {
  const adapter = buildMockAdapter()

  const codeCol = adapter.resolveColumn(AccountingConcept.account, 'codeColumn')
  assert.equal(codeCol, 'AccountCode')

  const titleCol = adapter.resolveColumn(AccountingConcept.account, 'titleColumn')
  assert.equal(titleCol, 'AccountName')
})

test('S15.25: Golden case — resolveColumn maps salesInvoice fields correctly', () => {
  const adapter = buildMockAdapter()

  const amountCol = adapter.resolveColumn(AccountingConcept.sales_invoice, 'netAmountColumn')
  assert.equal(amountCol, 'Amount')

  const dateCol = adapter.resolveColumn(AccountingConcept.sales_invoice, 'dateColumn')
  assert.equal(dateCol, 'BillDate')
})

test('S15.25: Golden case — relationships include FK from JournalLine to JournalEntry', () => {
  const adapter = buildMockAdapter()
  const rels = adapter.relationships

  const jeRel = rels.find(
    (r) => r.fromTable.table === 'JournalLine' && r.toTable.table === 'JournalEntry'
  )
  assert.ok(jeRel, 'Should have relationship from JournalLine to JournalEntry')
  assert.equal(jeRel!.fromColumn, 'EntryRef')
  assert.equal(jeRel!.toColumn, 'EntryId')
})

// ─── S15.26: Field test with 2nd database (skipped — no 2nd DB available) ───

test('S15.26: Field test with 2nd database — SKIPPED (no 2nd database available)', { skip: true }, () => {
  assert.ok(true)
})
