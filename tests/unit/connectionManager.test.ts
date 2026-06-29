import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ConnectionManager } from '../../src/main/services/connectionManager'
import { createAdapterStore, adapterKey } from '../../src/main/services/adapterStore'
import { SepidarAdapter } from '../../src/main/services/financialEngine/adapters/sepidarAdapter'
import { AccountingConcept, AccountCategory } from '../../src/main/services/financialEngine/schemaAdapter'
import type { SchemaAdapter, SoftwareConfig, JoinSpec } from '../../src/main/services/financialEngine/schemaAdapter'
import type { AppSettings, DiscoveredAdapterEntry } from '../../src/shared/contracts'
import { FinancialEngine } from '../../src/main/services/financialEngine/index'
import type { EngineRunResult } from '../../src/main/services/financialEngine/index'
import type { SqlQueryRow } from '../../src/shared/contracts'

// ─── Helpers ───

function makeBaseSettings(): AppSettings {
  return {
    gemini: {
      apiKey: 'test',
      baseUrl: 'http://localhost',
      model: 'test',
      mode: 'openai',
      temperature: 0.1,
      maxOutputTokens: 4096
    },
    sql: {
      server: '127.0.0.1',
      port: 1433,
      database: 'TestDB',
      user: 'sa',
      password: 'pass',
      encrypt: false,
      trustServerCertificate: true,
      connectionTimeoutMs: 5000,
      requestTimeoutMs: 10000,
      connectionRetryCount: 2,
      connectionRetryDelayMs: 2000
    },
    ssh: {
      enabled: false,
      host: '',
      port: 22,
      username: '',
      password: '',
      localHost: '127.0.0.1',
      localPort: 0,
      readyTimeoutMs: 15000,
      keepaliveIntervalMs: 10000,
      connectTimeoutMs: 10000,
      reconnectEnabled: true,
      maxReconnectAttempts: 3
    },
    sqlSecurity: {
      enforceReadOnlyLogin: false,
      forbidWildcardSelect: false,
      requireOrderByWhenLimited: false,
      blockQueryHints: false
    },
    telemetry: {
      enabled: false,
      level: 'info'
    },
    mobileBridge: {
      enabled: false,
      port: 0
    },
    schemaCatalogs: [],
    promptTemplates: [],
    financialEngineMode: 'engine',
    discoveredAdapters: {},
    softwareMode: 'sepidar'
  } as unknown as AppSettings
}

function makeMockAdapter(): SchemaAdapter {
  const tables: Record<string, { schema: string; table: string }> = {
    [AccountingConcept.sales_invoice]: { schema: 'SALES', table: 'Inv' },
    [AccountingConcept.voucher]: { schema: 'FIN', table: 'Vch' },
    [AccountingConcept.voucher_item]: { schema: 'FIN', table: 'VchItem' },
    [AccountingConcept.account]: { schema: 'FIN', table: 'Acct' },
    [AccountingConcept.fiscal_year]: { schema: 'SYS', table: 'Year' },
  }
  const columns: Record<string, Record<string, string>> = {
    [AccountingConcept.sales_invoice]: {
      net_amount: 'TotalAmount',
      date: 'InvDate',
      party_id: 'CustRef',
      primary_key: 'InvID',
      fiscal_year_id: 'YearRef',
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
      primary_key: 'ItemID',
    },
    [AccountingConcept.account]: {
      name: 'Name',
      code: 'Code',
      primary_key: 'AcctID',
    },
    [AccountingConcept.fiscal_year]: {
      title: 'Label',
      primary_key: 'YearID',
    },
  }

  return {
    softwareId: 'mocksoft',
    tables: tables as never,
    columns: columns as never,
    enums: {
      voucherType: { operational: [1, 2], tempClosing: [9], closing: [10], opening: [11] },
      inventoryReturnType: { normal: 0, return: 1 },
    },
    resolveTable(concept: AccountingConcept): string {
      const t = tables[concept]
      if (!t) throw new Error(`No table for concept: ${concept}`)
      return `${t.schema}.${t.table}`
    },
    resolveColumn(concept: AccountingConcept, field: string): string {
      const c = columns[concept]
      if (!c) throw new Error(`No columns for concept: ${concept}`)
      const col = c[field]
      if (!col) throw new Error(`No column for ${concept}.${field}`)
      return col
    },
    getVoucherTypeFilter(excludeClosing: boolean): string {
      if (excludeClosing) return 'v.DocType NOT IN (9, 10)'
      return '1=1'
    },
    getAccountClassification(category: AccountCategory): string {
      const map: Record<AccountCategory, string> = {
        [AccountCategory.asset]: "SUBSTRING(a.Code,1,1)='A'",
        [AccountCategory.liability]: "SUBSTRING(a.Code,1,1)='L'",
        [AccountCategory.equity]: "SUBSTRING(a.Code,1,1)='E'",
        [AccountCategory.revenue]: "SUBSTRING(a.Code,1,1)='R'",
        [AccountCategory.expense]: "SUBSTRING(a.Code,1,1)='X'",
      }
      return map[category]
    },
    getPersianTextFoldExpression(column: string): string {
      return `${column} COLLATE Arabic_CI_AI`
    },
    buildConnectionString(config: SoftwareConfig): string {
      return `Server=${config.server},${config.port};Database=${config.database};User Id=${config.user};Password=${config.password}`
    },
    getFiscalYearJoin(_sourceAlias: string, sourceColumn: string): JoinSpec {
      return {
        table: 'SYS.Year',
        alias: 'fy',
        on: { sourceColumn, targetColumn: 'YearID' },
      }
    },
    getFiscalYearColumn(_concept: AccountingConcept): string {
      return 'YearRef'
    },
    getPrimaryKeyColumn(concept: AccountingConcept): string {
      const c = columns[concept]
      if (!c) throw new Error(`No columns for concept: ${concept}`)
      return c['primary_key'] ?? 'ID'
    },
  } as unknown as SchemaAdapter
}

function makeCompilerDeps() {
  return {
    quoteSqlTableRef: (ref: string) => {
      const parts = ref.split('.')
      if (parts.length === 2) return `[${parts[0]}].[${parts[1]}]`
      return `[${ref}]`
    },
    quoteSqlIdentifier: (id: string) => `[${id}]`,
    normalizePersianText: (text: string) => text
  }
}

function makeMockExecutor(
  value: number
): (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]> {
  return async (_query: string, _signal?: AbortSignal): Promise<SqlQueryRow[]> => {
    return [{ result_value: value }]
  }
}

function asSingleResult(outcome: Awaited<ReturnType<FinancialEngine['run']>>): EngineRunResult {
  if ('results' in outcome) {
    throw new Error('Expected single-metric result but got MultiMetricResult')
  }
  return outcome
}

// ─── S15.23: ConnectionManager unit tests ───

test('S15.23: ConnectionManager — sepidar mode returns SepidarAdapter', () => {
  let settings = makeBaseSettings()
  settings.softwareMode = 'sepidar'

  const store = createAdapterStore(
    () => settings,
    async (patch) => { settings = { ...settings, ...patch } as AppSettings; return settings }
  )

  const cm = new ConnectionManager({ getSettings: () => settings, adapterStore: store })
  const result = cm.resolve()

  assert.equal(result.mode, 'sepidar')
  assert.equal(result.softwareId, 'sepidar')
  assert.ok(result.adapter instanceof SepidarAdapter)
  assert.ok(result.connectionString.includes('Server=127.0.0.1,1433'))
  assert.ok(result.connectionString.includes('Database=TestDB'))
})

test('S15.23: ConnectionManager — auto mode with no discovered adapter falls back to sepidar', () => {
  let settings = makeBaseSettings()
  settings.softwareMode = 'auto'

  const store = createAdapterStore(
    () => settings,
    async (patch) => { settings = { ...settings, ...patch } as AppSettings; return settings }
  )

  const cm = new ConnectionManager({ getSettings: () => settings, adapterStore: store })
  const result = cm.resolve()

  assert.equal(result.mode, 'sepidar')
  assert.equal(result.softwareId, 'sepidar')
  assert.ok(result.adapter instanceof SepidarAdapter)
})

test('S15.23: ConnectionManager — auto mode with confirmed adapter uses discovered adapter', () => {
  let settings = makeBaseSettings()
  settings.softwareMode = 'auto'

  const mockAdapter = makeMockAdapter()
  const key = adapterKey(settings.sql.server, settings.sql.database)
  const entry: DiscoveredAdapterEntry = {
    adapter: mockAdapter,
    discoveredAt: new Date().toISOString(),
    confirmed: true,
    connectionString: 'test',
    server: settings.sql.server,
    database: settings.sql.database,
    softwareName: 'mocksoft',
    confidence: 'high'
  }
  settings.discoveredAdapters = { [key]: entry }

  const store = createAdapterStore(
    () => settings,
    async (patch) => { settings = { ...settings, ...patch } as AppSettings; return settings }
  )

  const cm = new ConnectionManager({ getSettings: () => settings, adapterStore: store })
  const result = cm.resolve()

  assert.equal(result.mode, 'auto')
  assert.equal(result.softwareId, 'mocksoft')
  assert.ok(!(result.adapter instanceof SepidarAdapter))
})

test('S15.23: ConnectionManager — auto mode with unconfirmed adapter falls back to sepidar', () => {
  let settings = makeBaseSettings()
  settings.softwareMode = 'auto'

  const mockAdapter = makeMockAdapter()
  const key = adapterKey(settings.sql.server, settings.sql.database)
  const entry: DiscoveredAdapterEntry = {
    adapter: mockAdapter,
    discoveredAt: new Date().toISOString(),
    confirmed: false,
    connectionString: 'test',
    server: settings.sql.server,
    database: settings.sql.database,
  }
  settings.discoveredAdapters = { [key]: entry }

  const store = createAdapterStore(
    () => settings,
    async (patch) => { settings = { ...settings, ...patch } as AppSettings; return settings }
  )

  const cm = new ConnectionManager({ getSettings: () => settings, adapterStore: store })
  const result = cm.resolve()

  assert.equal(result.mode, 'sepidar')
  assert.equal(result.softwareId, 'sepidar')
  assert.ok(result.adapter instanceof SepidarAdapter)
})

test('S15.23: ConnectionManager — getActiveSoftwareId returns sepidar by default', () => {
  let settings = makeBaseSettings()
  settings.softwareMode = 'sepidar'

  const store = createAdapterStore(
    () => settings,
    async (patch) => { settings = { ...settings, ...patch } as AppSettings; return settings }
  )

  const cm = new ConnectionManager({ getSettings: () => settings, adapterStore: store })
  assert.equal(cm.getActiveSoftwareId(), 'sepidar')
})

test('S15.23: ConnectionManager — getActiveSoftwareId returns mocksoft when confirmed', () => {
  let settings = makeBaseSettings()
  settings.softwareMode = 'auto'

  const mockAdapter = makeMockAdapter()
  const key = adapterKey(settings.sql.server, settings.sql.database)
  settings.discoveredAdapters = {
    [key]: {
      adapter: mockAdapter,
      discoveredAt: new Date().toISOString(),
      confirmed: true,
      connectionString: 'test',
      server: settings.sql.server,
      database: settings.sql.database,
    }
  }

  const store = createAdapterStore(
    () => settings,
    async (patch) => { settings = { ...settings, ...patch } as AppSettings; return settings }
  )

  const cm = new ConnectionManager({ getSettings: () => settings, adapterStore: store })
  assert.equal(cm.getActiveSoftwareId(), 'mocksoft')
})

// ─── S15.23: Integration — dual path engine ───

test('S15.23: Integration — sepidar path: engine routes and compiles net_sales correctly', async () => {
  const sepidar = new SepidarAdapter()
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(5000000),
    adapter: sepidar,
    softwareId: 'sepidar'
  })

  const result = asSingleResult(await engine.run('فروش خالص سال ۱۴۰۲ چقدر است؟'))

  assert.ok(result.result, 'engine should produce a result')
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'net_sales')
  assert.equal(result.result!.rows[0]!['result_value'], 5000000)
})

test('S15.23: Integration — sepidar path: engine routes account_balance', async () => {
  const sepidar = new SepidarAdapter()
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(123456),
    adapter: sepidar,
    softwareId: 'sepidar'
  })

  const result = asSingleResult(await engine.run('مانده حساب دریافتنی‌ها چقدر است؟'))

  assert.ok(result.result, 'engine should produce a result')
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'account_balance')
})

test('S15.23: Integration — no adapter path: engine still works (legacy fallback)', async () => {
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(999999)
  })

  const result = asSingleResult(await engine.run('فروش خالص سال ۱۴۰۲ چقدر است؟'))

  assert.ok(result.result, 'engine should produce a result without adapter')
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'net_sales')
  assert.equal(result.result!.rows[0]!['result_value'], 999999)
})

test('S15.23: Integration — mock adapter path: engine compiles with mock schema', async () => {
  const mockAdapter = makeMockAdapter()
  const engine = new FinancialEngine({
    ...makeCompilerDeps(),
    executeReadOnlySql: makeMockExecutor(777777),
    adapter: mockAdapter,
    softwareId: 'mocksoft'
  })

  const result = asSingleResult(await engine.run('فروش خالص سال ۱۴۰۲ چقدر است؟'))

  assert.ok(result.result, 'engine should produce a result with mock adapter')
  assert.equal(result.verdict.ok, true)
  assert.equal(result.result!.plan.metricId, 'net_sales')
  assert.equal(result.result!.rows[0]!['result_value'], 777777)
})

test('S15.23: Integration — checkIntentAlignment passes with matching softwareId', async () => {
  const { checkIntentAlignment } = await import('../../src/main/services/financialEngine/verifier')
  const plan = { metricId: 'net_sales' as const, grain: 'total' as const, filters: [], confidence: 1.0 }
  const check = checkIntentAlignment('فروش خالص چقدر است؟', plan, 'sepidar')
  assert.ok(check.passed, 'intent alignment should pass for matching metric')
})
