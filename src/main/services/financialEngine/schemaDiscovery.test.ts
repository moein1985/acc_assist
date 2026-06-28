/**
 * Unit tests for Schema Discovery Engine (S15.4-S15.6)
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  scanDatabaseSchema,
  sampleTableRows,
  sampleMultipleTables,
  filterRelevantTables,
  makeColumnRef,
  type SqlExecutor,
  type RawSchemaInventory,
} from './schemaDiscovery'

// ─── Mock SQL executor ───

function makeMockExecutor(tables: Array<{
  schema: string
  table: string
  rows?: number
  columns?: Array<{ name: string; type?: string; nullable?: boolean; identity?: boolean }>
  pks?: string[]
  fks?: Array<{ column: string; refSchema: string; refTable: string; refColumn: string }>
}>): SqlExecutor {
  return async (sql: string): Promise<Record<string, unknown>[]> => {
    const lower = sql.toLowerCase()

    if (lower.includes('serverproperty')) {
      return [{ server_version: '15.0.1', database_name: 'TestDB' }]
    }

    if (lower.includes('is_ms_shipped = 0') && lower.includes('estimated_row_count')) {
      return tables.map((t) => ({
        schema_name: t.schema,
        table_name: t.table,
        estimated_row_count: t.rows ?? 100,
      }))
    }

    if (lower.includes('sys.columns c') && lower.includes('data_type')) {
      const rows: Record<string, unknown>[] = []
      for (const t of tables) {
        for (const col of t.columns ?? []) {
          rows.push({
            schema_name: t.schema,
            table_name: t.table,
            column_name: col.name,
            data_type: col.type ?? 'nvarchar',
            max_length: 50,
            is_nullable: col.nullable ? 1 : 0,
            is_identity: col.identity ? 1 : 0,
          })
        }
      }
      return rows
    }

    if (lower.includes("kc.type = 'pk'")) {
      const rows: Record<string, unknown>[] = []
      for (const t of tables) {
        for (const pk of t.pks ?? []) {
          rows.push({
            schema_name: t.schema,
            table_name: t.table,
            column_name: pk,
          })
        }
      }
      return rows
    }

    if (lower.includes('foreign_key_columns')) {
      const rows: Record<string, unknown>[] = []
      for (const t of tables) {
        for (const fk of t.fks ?? []) {
          rows.push({
            schema_name: t.schema,
            table_name: t.table,
            column_name: fk.column,
            referenced_schema: fk.refSchema,
            referenced_table: fk.refTable,
            referenced_column: fk.refColumn,
          })
        }
      }
      return rows
    }

    if (lower.includes('select top')) {
      // Return sample rows for sampling
      return [{ col1: 'val1', col2: 123 }]
    }

    return []
  }
}

// ─── S15.4: scanDatabaseSchema tests ───

test('scanDatabaseSchema', async (t) => {
  const executor = makeMockExecutor([
    {
      schema: 'ACC',
      table: 'Voucher',
      rows: 500,
      columns: [
        { name: 'VoucherId', type: 'int', identity: true },
        { name: 'Date', type: 'datetime' },
        { name: 'Type', type: 'int' },
      ],
      pks: ['VoucherId'],
      fks: [],
    },
    {
      schema: 'ACC',
      table: 'VoucherItem',
      rows: 5000,
      columns: [
        { name: 'VoucherItemId', type: 'int', identity: true },
        { name: 'VoucherRef', type: 'int' },
        { name: 'Debit', type: 'decimal' },
        { name: 'Credit', type: 'decimal' },
      ],
      pks: ['VoucherItemId'],
      fks: [{ column: 'VoucherRef', refSchema: 'ACC', refTable: 'Voucher', refColumn: 'VoucherId' }],
    },
  ])

  const inventory = await scanDatabaseSchema(executor)

  await t.test('returns server version', () => {
    assert.strictEqual(inventory.serverVersion, '15.0.1')
  })

  await t.test('returns database name', () => {
    assert.strictEqual(inventory.databaseName, 'TestDB')
  })

  await t.test('discovers 2 tables', () => {
    assert.strictEqual(inventory.tables.length, 2)
  })

  await t.test('has scannedAt timestamp', () => {
    assert.ok(inventory.scannedAt)
  })

  await t.test('Voucher table has correct schema', () => {
    const voucher = inventory.tables.find(
      (t) => t.tableRef.schema === 'ACC' && t.tableRef.table === 'Voucher'
    )
    assert.ok(voucher)
    assert.strictEqual(voucher!.estimatedRowCount, 500)
    assert.strictEqual(voucher!.columns.length, 3)
  })

  await t.test('VoucherItem has FK to Voucher', () => {
    const vi = inventory.tables.find(
      (t) => t.tableRef.schema === 'ACC' && t.tableRef.table === 'VoucherItem'
    )
    assert.ok(vi)
    assert.strictEqual(vi!.foreignKeys.length, 1)
    assert.strictEqual(vi!.foreignKeys[0].column, 'VoucherRef')
    assert.strictEqual(vi!.foreignKeys[0].referencedTable.table, 'Voucher')
  })

  await t.test('PK is correctly marked', () => {
    const voucher = inventory.tables.find(
      (t) => t.tableRef.schema === 'ACC' && t.tableRef.table === 'Voucher'
    )
    assert.ok(voucher)
    const idCol = voucher!.columns.find((c) => c.name === 'VoucherId')
    assert.ok(idCol)
    assert.strictEqual(idCol!.isPrimaryKey, true)
  })

  await t.test('non-PK column is not marked as PK', () => {
    const voucher = inventory.tables.find(
      (t) => t.tableRef.schema === 'ACC' && t.tableRef.table === 'Voucher'
    )
    assert.ok(voucher)
    const dateCol = voucher!.columns.find((c) => c.name === 'Date')
    assert.ok(dateCol)
    assert.strictEqual(dateCol!.isPrimaryKey, false)
  })
})

// ─── S15.5: sampleTableRows tests ───

test('sampleTableRows', async (t) => {
  const executor: SqlExecutor = async (sql: string) => {
    if (sql.toLowerCase().includes('select top')) {
      return [
        { Id: 1, Title: 'Test1' },
        { Id: 2, Title: 'Test2' },
      ]
    }
    return []
  }

  await t.test('returns sample rows', async () => {
    const sample = await sampleTableRows(
      { schema: 'ACC', table: 'Voucher' },
      executor
    )
    assert.strictEqual(sample.rows.length, 2)
    assert.strictEqual(sample.tableRef.table, 'Voucher')
  })

  await t.test('respects limit parameter in SQL', async () => {
    let capturedSql = ''
    const exec: SqlExecutor = async (sql: string) => {
      capturedSql = sql
      return []
    }
    await sampleTableRows({ schema: 'SLS', table: 'Invoice' }, exec, 3)
    assert.ok(capturedSql.includes('TOP (3)'))
  })

  await t.test('quotes identifiers correctly', async () => {
    let capturedSql = ''
    const exec: SqlExecutor = async (sql: string) => {
      capturedSql = sql
      return []
    }
    await sampleTableRows({ schema: 'SLS', table: 'Invoice' }, exec)
    assert.ok(capturedSql.includes('[SLS].[Invoice]'))
  })
})

test('sampleMultipleTables', async (t) => {
  const executor: SqlExecutor = async (sql: string) => {
    if (sql.toLowerCase().includes('select top')) {
      return [{ col1: 'val1' }]
    }
    return []
  }

  await t.test('returns samples for tables with rows', async () => {
    const samples = await sampleMultipleTables(
      [
        { schema: 'ACC', table: 'Voucher' },
        { schema: 'SLS', table: 'Invoice' },
      ],
      executor
    )
    assert.strictEqual(samples.length, 2)
  })

  await t.test('skips tables that error', async () => {
    const exec: SqlExecutor = async (sql: string) => {
      if (sql.includes('Voucher')) throw new Error('permission denied')
      return [{ col1: 'val1' }]
    }
    const samples = await sampleMultipleTables(
      [
        { schema: 'ACC', table: 'Voucher' },
        { schema: 'SLS', table: 'Invoice' },
      ],
      exec
    )
    assert.strictEqual(samples.length, 1)
    assert.strictEqual(samples[0].tableRef.table, 'Invoice')
  })
})

// ─── S15.6: filterRelevantTables tests ───

test('filterRelevantTables', (t) => {
  const inventory: RawSchemaInventory = {
    serverVersion: '15.0',
    databaseName: 'TestDB',
    scannedAt: new Date().toISOString(),
    tables: [
      { tableRef: { schema: 'ACC', table: 'Voucher' }, estimatedRowCount: 100, columns: [], foreignKeys: [] },
      { tableRef: { schema: 'ACC', table: 'Account' }, estimatedRowCount: 50, columns: [], foreignKeys: [] },
      { tableRef: { schema: 'SLS', table: 'Invoice' }, estimatedRowCount: 200, columns: [], foreignKeys: [] },
      { tableRef: { schema: 'sys', table: 'tables' }, estimatedRowCount: 999, columns: [], foreignKeys: [] },
      { tableRef: { schema: 'dbo', table: 'migration_log' }, estimatedRowCount: 10, columns: [], foreignKeys: [] },
      { tableRef: { schema: 'dbo', table: 'EmptyTable' }, estimatedRowCount: 0, columns: [], foreignKeys: [] },
      { tableRef: { schema: 'dbo', table: 'RandomTable' }, estimatedRowCount: 5, columns: [], foreignKeys: [] },
      {
        tableRef: { schema: 'ACC', table: 'VoucherItem' },
        estimatedRowCount: 1000,
        columns: [],
        foreignKeys: [{ column: 'VoucherRef', referencedTable: { schema: 'ACC', table: 'Voucher' }, referencedColumn: 'VoucherId' }],
      },
    ],
  }

  const filtered = filterRelevantTables(inventory)

  t.test('keeps accounting-relevant tables', () => {
    assert.ok(filtered.some((t) => t.tableRef.table === 'Voucher'))
    assert.ok(filtered.some((t) => t.tableRef.table === 'Account'))
    assert.ok(filtered.some((t) => t.tableRef.table === 'Invoice'))
  })

  t.test('removes system schema tables', () => {
    assert.ok(!filtered.some((t) => t.tableRef.schema === 'sys'))
  })

  t.test('removes irrelevant tables (migration_log)', () => {
    assert.ok(!filtered.some((t) => t.tableRef.table === 'migration_log'))
  })

  t.test('removes empty tables', () => {
    assert.ok(!filtered.some((t) => t.tableRef.table === 'EmptyTable'))
  })

  t.test('keeps tables with FKs even if not directly relevant', () => {
    assert.ok(filtered.some((t) => t.tableRef.table === 'VoucherItem'))
  })

  t.test('removes random tables with no FKs', () => {
    assert.ok(!filtered.some((t) => t.tableRef.table === 'RandomTable'))
  })
})

// ─── makeColumnRef helper test ───

test('makeColumnRef', () => {
  const ref = makeColumnRef({ schema: 'ACC', table: 'Voucher' }, 'VoucherId')
  assert.deepStrictEqual(ref, { schema: 'ACC', table: 'Voucher', column: 'VoucherId' })
})
