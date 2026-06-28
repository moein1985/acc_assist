import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compileMetricPlan,
  type CompilerDeps
} from '../../src/main/services/financialEngine/compiler'
import { normalizePersianText } from '../../src/main/services/textNormalization'
import {
  quoteSqlIdentifier,
  quoteSqlTableRef
} from '../../src/main/services/agentOrchestrator/sqlUtils'
import type { MetricPlan, MetricDefinition, ConceptSource, ConceptAggregateKind, ConceptDimensionBinding, ConceptFilter } from '../../src/main/services/financialEngine/types'
import { AccountingConcept, AccountCategory, type SchemaAdapter, type JoinSpec, type SoftwareConfig, type SchemaTableMapping, type SchemaColumnMapping, type SchemaRelationship, type SchemaEnumMapping, type DiscoveryMethod, type AdapterConfidence } from '../../src/main/services/financialEngine/schemaAdapter'
import { SepidarAdapter } from '../../src/main/services/financialEngine/adapters/sepidarAdapter'

const baseDeps: CompilerDeps = {
  quoteSqlTableRef,
  quoteSqlIdentifier,
  normalizePersianText
}

// ─── Mock adapter with different table/column names ───────────────────────

class MockAdapter implements SchemaAdapter {
  readonly softwareId = 'mocksoft'
  readonly softwareName = 'Mock Software'
  readonly discoveryMethod: DiscoveryMethod = 'auto'
  readonly confidence: AdapterConfidence = 'high'

  readonly tables: SchemaTableMapping = {
    salesInvoice: { schema: 'SALES', table: 'Inv' },
    voucher: { schema: 'FIN', table: 'Vch' },
    voucherItem: { schema: 'FIN', table: 'VchItem' },
    account: { schema: 'FIN', table: 'Acct' },
    fiscalYear: { schema: 'SYS', table: 'Year' },
  }

  readonly columns: SchemaColumnMapping = {
    salesInvoice: {
      idColumn: { schema: 'SALES', table: 'Inv', column: 'InvID' },
      netAmountColumn: { schema: 'SALES', table: 'Inv', column: 'TotalAmount' },
      fiscalYearRefColumn: { schema: 'SALES', table: 'Inv', column: 'YearRef' },
    },
    voucher: {
      idColumn: { schema: 'FIN', table: 'Vch', column: 'VchID' },
      typeColumn: { schema: 'FIN', table: 'Vch', column: 'DocType' },
      fiscalYearRefColumn: { schema: 'FIN', table: 'Vch', column: 'YearRef' },
    },
    voucherItem: {
      idColumn: { schema: 'FIN', table: 'VchItem', column: 'ItemID' },
      voucherRefColumn: { schema: 'FIN', table: 'VchItem', column: 'VchRef' },
      accountRefColumn: { schema: 'FIN', table: 'VchItem', column: 'AcctRef' },
      debitColumn: { schema: 'FIN', table: 'VchItem', column: 'Dr' },
      creditColumn: { schema: 'FIN', table: 'VchItem', column: 'Cr' },
    },
    account: {
      idColumn: { schema: 'FIN', table: 'Acct', column: 'AcctID' },
      codeColumn: { schema: 'FIN', table: 'Acct', column: 'Code' },
      titleColumn: { schema: 'FIN', table: 'Acct', column: 'Name' },
    },
    fiscalYear: {
      idColumn: { schema: 'SYS', table: 'Year', column: 'YearID' },
      titleColumn: { schema: 'SYS', table: 'Year', column: 'Label' },
    },
  }

  readonly relationships: SchemaRelationship[] = []
  readonly enums: SchemaEnumMapping = {
    voucherType: { closing: [9, 10], normal: [1, 2, 3] },
  }

  private readonly tableMap: Record<string, string> = {
    [AccountingConcept.sales_invoice]: 'SALES.Inv',
    [AccountingConcept.voucher]: 'FIN.Vch',
    [AccountingConcept.voucher_item]: 'FIN.VchItem',
    [AccountingConcept.account]: 'FIN.Acct',
    [AccountingConcept.fiscal_year]: 'SYS.Year',
  }

  private readonly columnMap: Record<string, Record<string, string>> = {
    [AccountingConcept.sales_invoice]: {
      net_amount: 'TotalAmount',
      date: 'InvDate',
      fiscal_year_id: 'YearRef',
      primary_key: 'InvID',
    },
    [AccountingConcept.voucher]: {
      date: 'VchDate',
      fiscal_year_id: 'YearRef',
      voucher_type: 'DocType',
      primary_key: 'VchID',
    },
    [AccountingConcept.voucher_item]: {
      debit: 'Dr',
      credit: 'Cr',
      account_id: 'AcctRef',
      voucher_id: 'VchRef',
      fiscal_year_id: 'YearRef',
      primary_key: 'ItemID',
    },
    [AccountingConcept.account]: {
      code: 'Code',
      name: 'Name',
      primary_key: 'AcctID',
    },
    [AccountingConcept.fiscal_year]: {
      title: 'Label',
      primary_key: 'YearID',
    },
  }

  resolveTable(concept: AccountingConcept): string {
    const t = this.tableMap[concept]
    if (!t) throw new Error(`No table mapping for concept: ${concept}`)
    return t
  }

  resolveColumn(concept: AccountingConcept, field: string): string {
    const cols = this.columnMap[concept]
    if (!cols) throw new Error(`No column mapping for concept: ${concept}`)
    const col = cols[field]
    if (!col) throw new Error(`No column mapping for concept ${concept}, field: ${field}`)
    return col
  }

  getFiscalYearJoin(sourceAlias: string, sourceColumn: string): JoinSpec {
    return {
      table: 'SYS.Year',
      alias: 'fy',
      on: { sourceColumn, targetColumn: 'YearID' },
    }
  }

  getVoucherTypeFilter(excludeClosing: boolean): string {
    if (excludeClosing) {
      return 'v.DocType NOT IN (9, 10)'
    }
    return ''
  }

  getAccountClassification(category: AccountCategory): string {
    const prefix = category === AccountCategory.asset ? '1'
      : category === AccountCategory.liability ? '2'
      : category === AccountCategory.equity ? '3'
      : category === AccountCategory.revenue ? '4'
      : '5'
    return `a.Code LIKE N'${prefix}%'`
  }

  getPersianTextFoldExpression(column: string): string {
    return `REPLACE(REPLACE(${column}, NCHAR(1610), NCHAR(1740)), NCHAR(1603), NCHAR(1705))`
  }

  buildConnectionString(config: SoftwareConfig): string {
    return `Server=${config.server},${config.port};Database=${config.database};User Id=${config.user};Password=${config.password};Encrypt=false`
  }

  getFiscalYearColumn(concept: AccountingConcept): string {
    return 'YearRef'
  }

  getPrimaryKeyColumn(concept: AccountingConcept): string {
    const cols = this.columnMap[concept]
    if (!cols) throw new Error(`No column mapping for concept: ${concept}`)
    return cols['primary_key'] ?? 'ID'
  }
}

// ─── Incomplete adapter (missing some concepts) ──────────────────────────

class IncompleteAdapter implements SchemaAdapter {
  readonly softwareId = 'incomplete'
  readonly softwareName = 'Incomplete Software'
  readonly discoveryMethod: DiscoveryMethod = 'auto'
  readonly confidence: AdapterConfidence = 'low'

  readonly tables: SchemaTableMapping = {
    voucher: { schema: 'FIN', table: 'Vch' },
    voucherItem: { schema: 'FIN', table: 'VchItem' },
  }
  readonly columns: SchemaColumnMapping = {
    voucher: {
      idColumn: { schema: 'FIN', table: 'Vch', column: 'VchID' },
    },
    voucherItem: {
      idColumn: { schema: 'FIN', table: 'VchItem', column: 'ItemID' },
    },
  }
  readonly relationships: SchemaRelationship[] = []
  readonly enums: SchemaEnumMapping = {}

  private readonly tableMap: Record<string, string> = {
    [AccountingConcept.voucher]: 'FIN.Vch',
    [AccountingConcept.voucher_item]: 'FIN.VchItem',
  }

  private readonly columnMap: Record<string, Record<string, string>> = {
    [AccountingConcept.voucher]: {
      primary_key: 'VchID',
    },
    [AccountingConcept.voucher_item]: {
      primary_key: 'ItemID',
    },
  }

  resolveTable(concept: AccountingConcept): string {
    const t = this.tableMap[concept]
    if (!t) throw new Error(`No table mapping for concept: ${concept}`)
    return t
  }

  resolveColumn(concept: AccountingConcept, field: string): string {
    const cols = this.columnMap[concept]
    if (!cols) throw new Error(`No column mapping for concept: ${concept}`)
    const col = cols[field]
    if (!col) throw new Error(`No column mapping for concept ${concept}, field: ${field}`)
    return col
  }

  getFiscalYearJoin(_sourceAlias: string, _sourceColumn: string): JoinSpec { throw new Error('No fiscal year mapping') }
  getVoucherTypeFilter(_excludeClosing: boolean): string { throw new Error('No voucher type mapping') }
  getAccountClassification(_category: AccountCategory): string { throw new Error('No account classification') }
  getPersianTextFoldExpression(column: string): string { return column }
  buildConnectionString(config: SoftwareConfig): string { return `Server=${config.server};Database=${config.database}` }
  getFiscalYearColumn(_concept: AccountingConcept): string { throw new Error('No fiscal year mapping') }
  getPrimaryKeyColumn(concept: AccountingConcept): string {
    return this.resolveColumn(concept, 'primary_key')
  }
}

// ─── Helper: build a concept-based MetricDefinition ──────────────────────

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
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
        },
        labelColumn: 'Title',
        labelType: 'nstring',
      },
    ],
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
  const conceptFilters: ConceptFilter[] = [
    {
      concept: AccountingConcept.voucher,
      field: 'voucher_type',
      op: 'not_in',
      value: ['tempClosing', 'closing'],
      description: 'Exclude closing vouchers',
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
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
        },
        labelColumn: 'Title',
        labelType: 'nstring',
      },
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'Exclude closing' }],
    conceptSource,
    conceptMeasure,
    conceptDimensions,
    conceptFilters,
    conceptEntityNameMatch: {
      concept: AccountingConcept.account,
      field: 'name',
      foldPersian: true,
    },
  }
}

// ─── Tests: SepidarAdapter produces same SQL as legacy ───────────────────

test('S15.19: SepidarAdapter — concept-based net_sales produces same SQL as legacy', () => {
  const def = makeConceptSalesDef()
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const sepidarDeps: CompilerDeps = { ...baseDeps, adapter: new SepidarAdapter() }

  const legacySql = compileMetricPlan(plan, def, baseDeps).sql
  const adapterSql = compileMetricPlan(plan, def, sepidarDeps).sql

  assert.ok(adapterSql.includes('SUM(CAST(src.[NetPriceInBaseCurrency] AS decimal(18,4)))'),
    'adapter should resolve net_amount to NetPriceInBaseCurrency')
  assert.ok(adapterSql.includes('FROM [SLS].[Invoice] src'),
    'adapter should resolve sales_invoice to SLS.Invoice')
  assert.ok(adapterSql === legacySql,
    'SepidarAdapter SQL should be identical to legacy SQL for net_sales')
})

test('S15.19: SepidarAdapter — concept-based by_year grain uses FiscalYear join', () => {
  const def = makeConceptSalesDef()
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'by_year',
    filters: [],
    confidence: 1.0,
  }

  const sepidarDeps: CompilerDeps = { ...baseDeps, adapter: new SepidarAdapter() }
  const { sql } = compileMetricPlan(plan, def, sepidarDeps)

  assert.ok(sql.includes('JOIN [FMK].[FiscalYear] fy'),
    'should join FMK.FiscalYear via adapter')
  assert.ok(sql.includes('fy.Title AS period'),
    'should select fy.Title as period via adapter')
  assert.ok(sql.includes('GROUP BY fy.Title'),
    'should GROUP BY fy.Title via adapter')
})

test('S15.19: SepidarAdapter — concept-based voucher_item with filters and entityName', () => {
  const def = makeConceptVoucherDef()
  const plan: MetricPlan = {
    metricId: 'account_balance',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    entityName: 'دریافتنی',
    confidence: 1.0,
  }

  const sepidarDeps: CompilerDeps = { ...baseDeps, adapter: new SepidarAdapter() }
  const { sql } = compileMetricPlan(plan, def, sepidarDeps)

  assert.ok(sql.includes('SUM(vi.[Debit]) - SUM(vi.[Credit])'),
    'adapter should resolve debit/credit columns')
  assert.ok(sql.includes('JOIN [ACC].[Voucher] v ON'),
    'adapter should resolve voucher join')
  assert.ok(sql.includes('JOIN [ACC].[Account] a ON'),
    'adapter should resolve account join for entityName')
  assert.ok(sql.includes('v.VoucherType NOT IN (3, 4)'),
    'adapter should resolve voucher_type filter via enums')
  assert.ok(sql.includes('REPLACE'),
    'adapter should use Persian text fold for entityName')
})

// ─── Tests: Mock adapter produces SQL with different names ───────────────

test('S15.19: MockAdapter — resolves sales_invoice to SALES.Inv with TotalAmount', () => {
  const def = makeConceptSalesDef()
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const mockDeps: CompilerDeps = { ...baseDeps, adapter: new MockAdapter() }
  const { sql } = compileMetricPlan(plan, def, mockDeps)

  assert.ok(sql.includes('FROM [SALES].[Inv] src'),
    'mock adapter should resolve to SALES.Inv')
  assert.ok(sql.includes('SUM(CAST(src.[TotalAmount] AS decimal(18,4)))'),
    'mock adapter should resolve net_amount to TotalAmount')
  assert.ok(!sql.includes('SLS.Invoice'),
    'mock adapter should NOT contain Sepidar table name')
  assert.ok(!sql.includes('NetPriceInBaseCurrency'),
    'mock adapter should NOT contain Sepidar column name')
})

test('S15.19: MockAdapter — by_year grain joins SYS.Year with Label', () => {
  const def = makeConceptSalesDef()
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'by_year',
    filters: [],
    confidence: 1.0,
  }

  const mockDeps: CompilerDeps = { ...baseDeps, adapter: new MockAdapter() }
  const { sql } = compileMetricPlan(plan, def, mockDeps)

  assert.ok(sql.includes('JOIN [SYS].[Year] fy'),
    'mock adapter should join SYS.Year')
  assert.ok(sql.includes('fy.Label AS period'),
    'mock adapter should use Label as period column')
  assert.ok(sql.includes('GROUP BY fy.Label'),
    'mock adapter should GROUP BY fy.Label')
})

test('S15.19: MockAdapter — voucher_item resolves to FIN.VchItem with Dr/Cr', () => {
  const def = makeConceptVoucherDef()
  const plan: MetricPlan = {
    metricId: 'account_balance',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    confidence: 1.0,
  }

  const mockDeps: CompilerDeps = { ...baseDeps, adapter: new MockAdapter() }
  const { sql } = compileMetricPlan(plan, def, mockDeps)

  assert.ok(sql.includes('FROM [FIN].[VchItem] vi'),
    'mock adapter should resolve voucher_item to FIN.VchItem')
  assert.ok(sql.includes('SUM(vi.[Dr]) - SUM(vi.[Cr])'),
    'mock adapter should resolve debit/credit to Dr/Cr')
  assert.ok(sql.includes('JOIN [FIN].[Vch] v ON'),
    'mock adapter should resolve voucher join to FIN.Vch')
  assert.ok(sql.includes('v.DocType NOT IN (9, 10)'),
    'mock adapter should resolve voucher_type filter via enums')
})

test('S15.19: MockAdapter — entityName uses Persian fold on resolved column', () => {
  const def = makeConceptVoucherDef()
  const plan: MetricPlan = {
    metricId: 'account_balance',
    grain: 'total',
    filters: [],
    entityName: 'دریافتنی',
    confidence: 1.0,
  }

  const mockDeps: CompilerDeps = { ...baseDeps, adapter: new MockAdapter() }
  const { sql } = compileMetricPlan(plan, def, mockDeps)

  assert.ok(sql.includes('a.Name'),
    'mock adapter should resolve account name to Name column')
  assert.ok(sql.includes('REPLACE'),
    'mock adapter should still apply Persian text fold')
})

// ─── Tests: Incomplete adapter throws graceful errors ────────────────────

test('S15.19: IncompleteAdapter — throws on missing sales_invoice concept', () => {
  const def = makeConceptSalesDef()
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const incompleteDeps: CompilerDeps = { ...baseDeps, adapter: new IncompleteAdapter() }

  assert.throws(
    () => compileMetricPlan(plan, def, incompleteDeps),
    /No table mapping for concept: sales_invoice/,
    'should throw graceful error for missing sales_invoice'
  )
})

test('S15.19: IncompleteAdapter — throws on missing column field', () => {
  const def = makeConceptVoucherDef()
  const plan: MetricPlan = {
    metricId: 'account_balance',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const incompleteDeps: CompilerDeps = { ...baseDeps, adapter: new IncompleteAdapter() }
  const defWithMissingCol: MetricDefinition = {
    ...def,
    conceptSource: {
      concept: AccountingConcept.voucher_item,
      alias: 'vi',
    },
    conceptMeasure: { kind: 'sum', field: 'nonexistent_field' },
  }

  assert.throws(
    () => compileMetricPlan(plan, defWithMissingCol, incompleteDeps),
    /No column mapping for concept voucher_item, field: nonexistent_field/,
    'should throw graceful error for missing column'
  )
})

test('S15.19: IncompleteAdapter — voucher_item primary_key still works', () => {
  const def: MetricDefinition = {
    id: 'recent_documents',
    titleFa: 'تعداد سند',
    anchors: ['تعداد سند'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'ACC.Voucher', alias: 'v' },
    measure: { kind: 'count' },
    dimensions: [],
    mandatoryFilters: [],
    conceptSource: { concept: AccountingConcept.voucher, alias: 'v' },
    conceptMeasure: { kind: 'count' },
  }
  const plan: MetricPlan = {
    metricId: 'recent_documents',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const incompleteDeps: CompilerDeps = { ...baseDeps, adapter: new IncompleteAdapter() }
  const { sql } = compileMetricPlan(plan, def, incompleteDeps)

  assert.ok(sql.includes('FROM [FIN].[Vch] v'),
    'incomplete adapter should still resolve voucher table')
  assert.ok(sql.includes('COUNT(*)'),
    'incomplete adapter should handle count measure')
})

// ─── Tests: No adapter = legacy behavior unchanged ───────────────────────

test('S15.19: No adapter — conceptSource ignored, legacy source used', () => {
  const def = makeConceptSalesDef()
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const { sql } = compileMetricPlan(plan, def, baseDeps)

  assert.ok(sql.includes('FROM [SLS].[Invoice] src'),
    'without adapter, should use legacy source')
  assert.ok(sql.includes('NetPriceInBaseCurrency'),
    'without adapter, should use legacy column')
})

test('S15.19: No adapter + no conceptSource — pure legacy path', () => {
  const def: MetricDefinition = {
    id: 'net_sales',
    titleFa: 'فروش خالص',
    anchors: ['فروش'],
    softwareId: 'sepidar',
    grainSupported: ['total'],
    source: { primaryTable: 'SLS.Invoice', alias: 'src' },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
    dimensions: [],
    mandatoryFilters: [],
  }
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0,
  }

  const { sql } = compileMetricPlan(plan, def, baseDeps)
  assert.ok(sql.includes('SUM(CAST(src.[NetPriceInBaseCurrency] AS decimal(18,4)))'),
    'pure legacy path should work')
})
