/**
 * Unit tests for Semantic Mapping Engine (S15.7-S15.12)
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  heuristicMapTables,
  buildLlmMappingPrompt,
  inferRelationships,
  detectEnums,
  buildAdapter,
  type HeuristicMappingResult,
} from './semanticMapping'
import type { RawSchemaInventory, RawTableInfo } from './schemaDiscovery'
import { AccountingConcept, AccountCategory } from './schemaAdapter'

// ─── Helper: build a mock inventory ───

function makeInventory(tables: RawTableInfo[]): RawSchemaInventory {
  return {
    serverVersion: '15.0',
    databaseName: 'TestDB',
    scannedAt: new Date().toISOString(),
    tables,
  }
}

function makeTable(
  schema: string,
  table: string,
  columns: Array<{ name: string; type?: string; pk?: boolean; identity?: boolean }>,
  fks?: Array<{ column: string; refSchema: string; refTable: string; refColumn: string }>,
  rows?: number
): RawTableInfo {
  return {
    tableRef: { schema, table },
    estimatedRowCount: rows ?? 100,
    columns: columns.map((c) => ({
      name: c.name,
      dataType: c.type ?? 'nvarchar',
      maxLength: 50,
      isNullable: !c.pk,
      isIdentity: c.identity ?? false,
      isPrimaryKey: c.pk ?? false,
    })),
    foreignKeys: (fks ?? []).map((f) => ({
      column: f.column,
      referencedTable: { schema: f.refSchema, table: f.refTable },
      referencedColumn: f.refColumn,
    })),
  }
}

// ─── S15.7: heuristicMapTables ───

test('heuristicMapTables', (t) => {
  const inventory = makeInventory([
    makeTable('ACC', 'Voucher', [
      { name: 'VoucherId', type: 'int', pk: true, identity: true },
      { name: 'VoucherDate', type: 'datetime' },
      { name: 'Type', type: 'int' },
      { name: 'FiscalYearRef', type: 'int' },
      { name: 'Number', type: 'int' },
    ]),
    makeTable('ACC', 'VoucherItem', [
      { name: 'VoucherItemId', type: 'int', pk: true, identity: true },
      { name: 'VoucherRef', type: 'int' },
      { name: 'AccountRef', type: 'int' },
      { name: 'Debit', type: 'decimal' },
      { name: 'Credit', type: 'decimal' },
    ], [{ column: 'VoucherRef', refSchema: 'ACC', refTable: 'Voucher', refColumn: 'VoucherId' }], 1000),
    makeTable('ACC', 'Account', [
      { name: 'AccountId', type: 'int', pk: true, identity: true },
      { name: 'Code', type: 'nvarchar' },
      { name: 'Title', type: 'nvarchar' },
    ]),
    makeTable('FMK', 'FiscalYear', [
      { name: 'FiscalYearId', type: 'int', pk: true, identity: true },
      { name: 'Title', type: 'nvarchar' },
    ]),
    makeTable('SLS', 'Invoice', [
      { name: 'InvoiceId', type: 'int', pk: true, identity: true },
      { name: 'InvoiceDate', type: 'datetime' },
      { name: 'NetPriceInBaseCurrency', type: 'decimal' },
      { name: 'FiscalYearRef', type: 'int' },
      { name: 'PartyRef', type: 'int' },
    ], [], 500),
    makeTable('ACC', 'Partner', [
      { name: 'PartnerId', type: 'int', pk: true, identity: true },
      { name: 'Title', type: 'nvarchar' },
    ]),
    makeTable('dbo', 'RandomTable', [
      { name: 'Id', type: 'int', pk: true },
    ], [], 5),
  ])

  const result = heuristicMapTables(inventory)

  t.test('maps voucher table', () => {
    assert.ok(result.tables.voucher)
    assert.strictEqual(result.tables.voucher!.schema, 'ACC')
    assert.strictEqual(result.tables.voucher!.table, 'Voucher')
  })

  t.test('maps voucherItem table', () => {
    assert.ok(result.tables.voucherItem)
    assert.strictEqual(result.tables.voucherItem!.table, 'VoucherItem')
  })

  t.test('maps account table', () => {
    assert.ok(result.tables.account)
    assert.strictEqual(result.tables.account!.table, 'Account')
  })

  t.test('maps fiscalYear table', () => {
    assert.ok(result.tables.fiscalYear)
    assert.strictEqual(result.tables.fiscalYear!.table, 'FiscalYear')
  })

  t.test('maps salesInvoice table', () => {
    assert.ok(result.tables.salesInvoice)
    assert.strictEqual(result.tables.salesInvoice!.table, 'Invoice')
  })

  t.test('maps party table', () => {
    assert.ok(result.tables.party)
    assert.strictEqual(result.tables.party!.table, 'Partner')
  })

  t.test('maps columns for voucher', () => {
    assert.ok(result.columns.voucher)
    assert.ok(result.columns.voucher!.idColumn)
    assert.ok(result.columns.voucher!.dateColumn)
    assert.strictEqual(result.columns.voucher!.idColumn!.column, 'VoucherId')
  })

  t.test('maps columns for voucherItem', () => {
    assert.ok(result.columns.voucherItem)
    assert.ok(result.columns.voucherItem!.debitColumn)
    assert.strictEqual(result.columns.voucherItem!.debitColumn!.column, 'Debit')
    assert.strictEqual(result.columns.voucherItem!.creditColumn!.column, 'Credit')
  })

  t.test('maps columns for account', () => {
    assert.ok(result.columns.account)
    assert.strictEqual(result.columns.account!.codeColumn!.column, 'Code')
    assert.strictEqual(result.columns.account!.titleColumn!.column, 'Title')
  })

  t.test('confidence is high with core concepts mapped', () => {
    assert.strictEqual(result.confidence, 'high')
  })

  t.test('unmatched includes RandomTable', () => {
    assert.ok(result.unmatched.some((u) => u.includes('RandomTable')))
  })
})

test('heuristicMapTables - low confidence with few matches', () => {
  const inventory = makeInventory([
    makeTable('dbo', 'TableA', [{ name: 'Id', pk: true }], [], 10),
    makeTable('dbo', 'TableB', [{ name: 'Id', pk: true }], [], 20),
  ])
  const result = heuristicMapTables(inventory)
  assert.strictEqual(result.confidence, 'low')
})

// ─── S15.8: buildLlmMappingPrompt ───

test('buildLlmMappingPrompt', (t) => {
  const inventory = makeInventory([
    makeTable('ACC', 'Voucher', [
      { name: 'VoucherId', pk: true },
      { name: 'Date' },
    ]),
  ])
  const heuristic: HeuristicMappingResult = {
    tables: { voucher: { schema: 'ACC', table: 'Voucher' } },
    columns: {},
    confidence: 'medium',
    unmatched: ['dbo.UnknownTable'],
  }

  const prompt = buildLlmMappingPrompt({ inventory, heuristicResult: heuristic })

  t.test('includes table list', () => {
    assert.ok(prompt.includes('ACC.Voucher'))
  })

  t.test('includes heuristic mapping', () => {
    assert.ok(prompt.includes('voucher: ACC.Voucher'))
  })

  t.test('includes unmatched tables', () => {
    assert.ok(prompt.includes('dbo.UnknownTable'))
  })

  t.test('includes JSON format instruction', () => {
    assert.ok(prompt.includes('JSON'))
  })

  t.test('includes available concepts', () => {
    assert.ok(prompt.includes('salesInvoice'))
    assert.ok(prompt.includes('voucherItem'))
  })
})

// ─── S15.9: inferRelationships ───

test('inferRelationships', (t) => {
  const inventory = makeInventory([
    makeTable('ACC', 'Voucher', [
      { name: 'VoucherId', pk: true },
      { name: 'FiscalYearRef' },
    ]),
    makeTable('ACC', 'VoucherItem', [
      { name: 'VoucherItemId', pk: true },
      { name: 'VoucherRef' },
      { name: 'AccountRef' },
    ], [{ column: 'VoucherRef', refSchema: 'ACC', refTable: 'Voucher', refColumn: 'VoucherId' }]),
    makeTable('ACC', 'Account', [
      { name: 'AccountId', pk: true },
    ]),
    makeTable('FMK', 'FiscalYear', [
      { name: 'FiscalYearId', pk: true },
    ]),
  ])

  const tableMapping = {
    voucher: { schema: 'ACC', table: 'Voucher' },
    voucherItem: { schema: 'ACC', table: 'VoucherItem' },
    account: { schema: 'ACC', table: 'Account' },
    fiscalYear: { schema: 'FMK', table: 'FiscalYear' },
  }

  const rels = inferRelationships(inventory, tableMapping)

  t.test('includes physical FK from VoucherItem to Voucher', () => {
    const fk = rels.find(
      (r) => r.fromTable.table === 'VoucherItem' && r.toTable.table === 'Voucher'
    )
    assert.ok(fk)
    assert.strictEqual(fk!.type, 'fk')
  })

  t.test('includes logical relationship from Voucher to FiscalYear', () => {
    const logical = rels.find(
      (r) => r.fromTable.table === 'Voucher' && r.toTable.table === 'FiscalYear'
    )
    assert.ok(logical)
    assert.strictEqual(logical!.type, 'logical')
    assert.strictEqual(logical!.fromColumn, 'FiscalYearRef')
  })

  t.test('deduplicates relationships', () => {
    const dedupKeys = new Set(
      rels.map((r) => r.fromTable.schema + '.' + r.fromTable.table + '.' + r.fromColumn + '->' + r.toTable.table)
    )
    assert.strictEqual(rels.length, dedupKeys.size)
  })
})

// ─── S15.10: detectEnums ───

test('detectEnums', (t) => {
  const inventory = makeInventory([
    makeTable('ACC', 'Voucher', [
      { name: 'VoucherId', pk: true },
      { name: 'Type', type: 'int' },
    ]),
    makeTable('INV', 'InventoryReceipt', [
      { name: 'InventoryReceiptId', pk: true },
      { name: 'IsReturn', type: 'bit' },
    ]),
  ])

  const tableMapping = {
    voucher: { schema: 'ACC', table: 'Voucher' },
    inventoryReceipt: { schema: 'INV', table: 'InventoryReceipt' },
  }

  const samples = [
    {
      tableRef: { schema: 'ACC', table: 'Voucher' },
      columns: [],
      rows: [
        { Type: 1, VoucherId: 1 },
        { Type: 2, VoucherId: 2 },
        { Type: 4, VoucherId: 3 },
      ],
    },
  ]

  const enums = detectEnums(inventory, tableMapping, samples)

  t.test('detects voucherType enum', () => {
    assert.ok(enums.voucherType)
    assert.deepStrictEqual(enums.voucherType!.operational, [1, 2])
    assert.deepStrictEqual(enums.voucherType!.closing, [4])
  })

  t.test('detects inventoryReturnType enum', () => {
    assert.ok(enums.inventoryReturnType)
    assert.strictEqual(enums.inventoryReturnType!.normal, 0)
    assert.strictEqual(enums.inventoryReturnType!.return, 1)
  })
})

test('detectEnums - defaults without samples', () => {
  const inventory = makeInventory([
    makeTable('ACC', 'Voucher', [
      { name: 'VoucherId', pk: true },
      { name: 'Type', type: 'int' },
    ]),
  ])
  const tableMapping = {
    voucher: { schema: 'ACC', table: 'Voucher' },
  }
  const enums = detectEnums(inventory, tableMapping)
  assert.ok(enums.voucherType)
  assert.deepStrictEqual(enums.voucherType!.operational, [1, 2])
})

// ─── S15.11: buildAdapter ───

test('buildAdapter', (t) => {
  const adapter = buildAdapter({
    softwareId: 'test-software',
    softwareName: 'Test Software',
    tables: {
      voucher: { schema: 'ACC', table: 'Voucher' },
      voucherItem: { schema: 'ACC', table: 'VoucherItem' },
      account: { schema: 'ACC', table: 'Account' },
      fiscalYear: { schema: 'FMK', table: 'FiscalYear' },
      party: { schema: 'ACC', table: 'Partner' },
    },
    columns: {
      voucher: {
        idColumn: { schema: 'ACC', table: 'Voucher', column: 'VoucherId' },
        dateColumn: { schema: 'ACC', table: 'Voucher', column: 'Date' },
        typeColumn: { schema: 'ACC', table: 'Voucher', column: 'Type' },
        fiscalYearRefColumn: { schema: 'ACC', table: 'Voucher', column: 'FiscalYearRef' },
      },
      voucherItem: {
        idColumn: { schema: 'ACC', table: 'VoucherItem', column: 'VoucherItemId' },
        debitColumn: { schema: 'ACC', table: 'VoucherItem', column: 'Debit' },
        creditColumn: { schema: 'ACC', table: 'VoucherItem', column: 'Credit' },
      },
      account: {
        idColumn: { schema: 'ACC', table: 'Account', column: 'AccountId' },
        codeColumn: { schema: 'ACC', table: 'Account', column: 'Code' },
        titleColumn: { schema: 'ACC', table: 'Account', column: 'Title' },
      },
      fiscalYear: {
        idColumn: { schema: 'FMK', table: 'FiscalYear', column: 'FiscalYearId' },
      },
    },
    relationships: [
      {
        fromTable: { schema: 'ACC', table: 'VoucherItem' },
        fromColumn: 'VoucherRef',
        toTable: { schema: 'ACC', table: 'Voucher' },
        toColumn: 'VoucherId',
        type: 'fk',
      },
    ],
    enums: {
      voucherType: { operational: [1, 2], closing: [4] },
    },
    confidence: 'high',
  })

  t.test('has correct softwareId', () => {
    assert.strictEqual(adapter.softwareId, 'test-software')
  })

  t.test('has discoveryMethod=auto', () => {
    assert.strictEqual(adapter.discoveryMethod, 'auto')
  })

  t.test('has discoveredAt timestamp', () => {
    assert.ok(adapter.discoveredAt)
  })

  t.test('resolveTable works', () => {
    assert.strictEqual(adapter.resolveTable(AccountingConcept.voucher), 'ACC.Voucher')
  })

  t.test('resolveColumn works', () => {
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.voucher, 'idColumn'), 'VoucherId')
    assert.strictEqual(adapter.resolveColumn(AccountingConcept.voucher_item, 'debitColumn'), 'Debit')
  })

  t.test('getFiscalYearJoin works', () => {
    const join = adapter.getFiscalYearJoin('v', 'FiscalYearRef')
    assert.strictEqual(join.table, 'FMK.FiscalYear')
    assert.strictEqual(join.alias, 'fy')
    assert.strictEqual(join.on.targetColumn, 'FiscalYearId')
  })

  t.test('getVoucherTypeFilter excludes closing', () => {
    const filter = adapter.getVoucherTypeFilter(true)
    assert.ok(filter.includes('NOT IN'))
    assert.ok(filter.includes('4'))
  })

  t.test('getVoucherTypeFilter no filter when excludeClosing=false', () => {
    const filter = adapter.getVoucherTypeFilter(false)
    assert.strictEqual(filter, '1=1')
  })

  t.test('getAccountClassification works', () => {
    const filter = adapter.getAccountClassification(AccountCategory.asset)
    assert.ok(filter.includes('SUBSTRING'))
    assert.ok(filter.includes("'1'"))
  })

  t.test('getPersianTextFoldExpression works', () => {
    const expr = adapter.getPersianTextFoldExpression('a.Title')
    assert.ok(expr.includes('COLLATE'))
  })

  t.test('buildConnectionString works', () => {
    const connStr = adapter.buildConnectionString({
      server: 'localhost',
      port: 1433,
      database: 'TestDB',
      user: 'sa',
      password: 'pass',
    })
    assert.ok(connStr.includes('Server=localhost,1433'))
  })

  t.test('getFiscalYearColumn works', () => {
    assert.strictEqual(adapter.getFiscalYearColumn(AccountingConcept.voucher), 'FiscalYearRef')
  })

  t.test('getPrimaryKeyColumn works', () => {
    assert.strictEqual(adapter.getPrimaryKeyColumn(AccountingConcept.voucher), 'VoucherId')
  })

  t.test('relationships are preserved', () => {
    assert.strictEqual(adapter.relationships.length, 1)
    assert.strictEqual(adapter.relationships[0].fromTable.table, 'VoucherItem')
  })

  t.test('enums are preserved', () => {
    assert.deepStrictEqual(adapter.enums.voucherType?.operational, [1, 2])
  })
})
