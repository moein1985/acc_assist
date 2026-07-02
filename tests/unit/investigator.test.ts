import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldInvestigate,
  clusterLedgers,
  buildMultiLedgerClarifyMessage,
  SchemaCache,
  DEFAULT_BUDGET,
  investigate,
  type EvidenceEntry,
  type LedgerCluster,
  type InvestigatorDeps,
} from '../../src/main/services/financialEngine/investigator'
import type { SqlQueryRow } from '../../src/shared/contracts'

function makeNormText(s: string): string {
  return s
    .replace(/\u064A/g, '\u06CC')
    .replace(/\u0649/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/\u0623/g, '\u0627')
    .trim()
}

function makeDeps(executeFn: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>): InvestigatorDeps {
  return {
    executeReadOnlySql: executeFn,
    normalizePersianText: makeNormText,
  }
}

// ─── S26.18: clusterLedgers unit tests ───

describe('clusterLedgers (S26.18)', () => {
  test('returns empty array for no enumerate evidence', () => {
    const evidence: EvidenceEntry[] = [
      {
        probeType: 'locate_entity',
        table: 'ACC.Partner',
        sql: '-- test',
        rows: [{ PartnerId: 1, Title: 'Test' }],
        timestamp: new Date().toISOString(),
      },
    ]
    const clusters = clusterLedgers(evidence)
    assert.equal(clusters.length, 0)
  })

  test('clusters enumerate_ledgers rows by account code', () => {
    const evidence: EvidenceEntry[] = [
      {
        probeType: 'enumerate_ledgers',
        table: 'ACC.VoucherItem',
        sql: '-- test',
        rows: [
          { AccountCode: '0101', AccountTitle: 'حساب جاری', TotalDebit: 1000, TotalCredit: 500, VoucherCount: 10, MinDate: '2024-01-01', MaxDate: '2024-12-31' },
          { AccountCode: '0102', AccountTitle: 'حساب تأمین', TotalDebit: 2000, TotalCredit: 1500, VoucherCount: 5, MinDate: '2024-02-01', MaxDate: '2024-11-30' },
        ],
        timestamp: new Date().toISOString(),
      },
    ]
    const clusters = clusterLedgers(evidence)
    assert.equal(clusters.length, 2)
    assert.equal(clusters[0]!.accountCode, '0101')
    assert.equal(clusters[0]!.accountTitle, 'حساب جاری')
    assert.equal(clusters[0]!.totalDebit, 1000)
    assert.equal(clusters[0]!.totalCredit, 500)
    assert.equal(clusters[0]!.netBalance, 500)
    assert.equal(clusters[0]!.voucherCount, 10)
    assert.equal(clusters[1]!.accountCode, '0102')
    assert.equal(clusters[1]!.netBalance, 500)
  })

  test('attaches partner info from locate_entity evidence', () => {
    const evidence: EvidenceEntry[] = [
      {
        probeType: 'locate_entity',
        table: 'ACC.Partner',
        sql: '-- test',
        rows: [{ PartnerId: 42, Title: 'شرکت نمونه', MatchScore: 100, MatchMethod: 'exact' }],
        timestamp: new Date().toISOString(),
      },
      {
        probeType: 'enumerate_ledgers',
        table: 'ACC.VoucherItem',
        sql: '-- test',
        rows: [
          { AccountCode: '0101', AccountTitle: 'جاری', TotalDebit: 500, TotalCredit: 300, VoucherCount: 3, MinDate: null, MaxDate: null },
        ],
        timestamp: new Date().toISOString(),
      },
    ]
    const clusters = clusterLedgers(evidence)
    assert.equal(clusters.length, 1)
    assert.equal(clusters[0]!.partnerId, 42)
    assert.equal(clusters[0]!.partnerTitle, 'شرکت نمونه')
  })

  test('deduplicates by account code', () => {
    const evidence: EvidenceEntry[] = [
      {
        probeType: 'enumerate_ledgers',
        table: 'ACC.VoucherItem',
        sql: '-- test1',
        rows: [
          { AccountCode: '0101', AccountTitle: 'A', TotalDebit: 100, TotalCredit: 50, VoucherCount: 1, MinDate: null, MaxDate: null },
        ],
        timestamp: new Date().toISOString(),
      },
      {
        probeType: 'enumerate_ledgers',
        table: 'ACC.VoucherItem',
        sql: '-- test2',
        rows: [
          { AccountCode: '0101', AccountTitle: 'A', TotalDebit: 200, TotalCredit: 100, VoucherCount: 2, MinDate: null, MaxDate: null },
        ],
        timestamp: new Date().toISOString(),
      },
    ]
    const clusters = clusterLedgers(evidence)
    assert.equal(clusters.length, 1)
  })

  test('handles negative net balance (bostenkar)', () => {
    const evidence: EvidenceEntry[] = [
      {
        probeType: 'enumerate_ledgers',
        table: 'ACC.VoucherItem',
        sql: '-- test',
        rows: [
          { AccountCode: '0101', AccountTitle: 'حساب', TotalDebit: 100, TotalCredit: 300, VoucherCount: 1, MinDate: null, MaxDate: null },
        ],
        timestamp: new Date().toISOString(),
      },
    ]
    const clusters = clusterLedgers(evidence)
    assert.equal(clusters.length, 1)
    assert.equal(clusters[0]!.netBalance, -200)
  })
})

// ─── S26.1: shouldInvestigate tests ───

describe('shouldInvestigate (S26.1)', () => {
  test('returns false when metric matched and rows not empty', () => {
    assert.equal(shouldInvestigate('فروش ۱۴۰۲', true, false), false)
  })

  test('returns true when no metric matched but prompt has financial signals', () => {
    assert.equal(shouldInvestigate('گردش حساب معین محسنی فرد', false, false), true)
  })

  test('returns true when metric matched but rows empty (zero results)', () => {
    assert.equal(shouldInvestigate('مانده حساب بانکی', true, true), true)
  })

  test('returns false for non-financial prompts', () => {
    assert.equal(shouldInvestigate('hello world', false, false), false)
  })

  test('returns true for English financial terms', () => {
    assert.equal(shouldInvestigate('show me the balance sheet', false, false), true)
  })
})

// ─── S26.11: buildMultiLedgerClarifyMessage tests ───

describe('buildMultiLedgerClarifyMessage (S26.11)', () => {
  test('builds Persian clarification with cluster details', () => {
    const clusters: LedgerCluster[] = [
      {
        accountTitle: 'جاری شرکا',
        accountCode: '0101',
        partnerId: 1,
        partnerTitle: 'شرکت نمونه',
        totalDebit: 1000,
        totalCredit: 500,
        netBalance: 500,
        voucherCount: 10,
        dateRange: { min: null, max: null },
        evidenceRefs: [0],
      },
      {
        accountTitle: 'تأمین‌کننده',
        accountCode: '0102',
        partnerId: 1,
        partnerTitle: 'شرکت نمونه',
        totalDebit: 200,
        totalCredit: 800,
        netBalance: -600,
        voucherCount: 5,
        dateRange: { min: null, max: null },
        evidenceRefs: [0],
      },
    ]
    const msg = buildMultiLedgerClarifyMessage('شرکت نمونه', clusters)
    assert.ok(msg.includes('شرکت نمونه'))
    assert.ok(msg.includes('جاری شرکا'))
    assert.ok(msg.includes('تأمین'))
    assert.ok(msg.includes('۱.') || msg.includes('1.'))
  })

  test('limits to 5 clusters in message', () => {
    const clusters: LedgerCluster[] = Array.from({ length: 10 }, (_, i) => ({
      accountTitle: `حساب ${i}`,
      accountCode: `010${i}`,
      partnerId: null,
      partnerTitle: null,
      totalDebit: 100,
      totalCredit: 50,
      netBalance: 50,
      voucherCount: 1,
      dateRange: { min: null, max: null },
      evidenceRefs: [0],
    }))
    const msg = buildMultiLedgerClarifyMessage('test', clusters)
    const lines = msg.split('\n')
    // First line is the header, then max 5 cluster lines
    assert.ok(lines.length <= 6)
  })
})

// ─── S26.14: SchemaCache tests ───

describe('SchemaCache (S26.14)', () => {
  test('returns null when empty', () => {
    const cache = new SchemaCache()
    assert.equal(cache.get(), null)
  })

  test('stores and retrieves data', () => {
    const cache = new SchemaCache(300_000)
    const mockData = {
      inventory: {
        serverVersion: 'test',
        databaseName: 'testdb',
        tables: [],
        scannedAt: new Date().toISOString(),
      },
      heuristic: { tables: {}, columns: {}, confidence: 'high' as const, unmatched: [] },
      relationships: [],
      enums: {},
    }
    cache.set(mockData)
    const result = cache.get()
    assert.ok(result !== null)
    assert.equal(result.inventory.databaseName, 'testdb')
  })

  test('expires after TTL', () => {
    const cache = new SchemaCache(1) // 1ms TTL
    const mockData = {
      inventory: {
        serverVersion: 'test',
        databaseName: 'testdb',
        tables: [],
        scannedAt: new Date().toISOString(),
      },
      heuristic: { tables: {}, columns: {}, confidence: 'high' as const, unmatched: [] },
      relationships: [],
      enums: {},
    }
    cache.set(mockData)
    // Wait a bit for TTL to expire
    setTimeout(() => {
      assert.equal(cache.get(), null)
    }, 10)
  })

  test('clear empties cache', () => {
    const cache = new SchemaCache()
    const mockData = {
      inventory: {
        serverVersion: 'test',
        databaseName: 'testdb',
        tables: [],
        scannedAt: new Date().toISOString(),
      },
      heuristic: { tables: {}, columns: {}, confidence: 'high' as const, unmatched: [] },
      relationships: [],
      enums: {},
    }
    cache.set(mockData)
    cache.clear()
    assert.equal(cache.get(), null)
  })
})

// ─── S26.20: Loop boundedness test ───

describe('investigator loop boundedness (S26.20)', () => {
  test('respects maxQueries budget', async () => {
    let queryCount = 0
    const deps = makeDeps(async () => {
      queryCount++
      return []
    })

    // scanDatabaseSchema makes 5 fixed queries before the loop starts.
    // With maxQueries=5, the loop should not execute any additional probes.
    const smallBudget = { maxQueries: 5, timeoutMs: 5000, maxDepth: 2 }
    const result = await investigate('گردش حساب', deps, undefined, smallBudget)
    assert.equal(result.kind, 'refuse')
    // Schema scan uses exactly 5 queries; no loop probes should execute
    assert.equal(queryCount, 5, `queryCount should be exactly 5 (schema scan only) but was ${queryCount}`)
  })

  test('respects maxDepth budget', async () => {
    let queryCount = 0
    const deps = makeDeps(async () => {
      queryCount++
      // Return empty for all queries — schema scan returns empty tables
      return []
    })

    const smallBudget = { maxQueries: 100, timeoutMs: 5000, maxDepth: 1 }
    await investigate('گردش حساب', deps, undefined, smallBudget)
    // With maxDepth=1, the loop should only run 1 iteration
    // Schema scan uses 5 queries, then 1 depth iteration
    assert.ok(queryCount <= 10, `queryCount should be <= 10 but was ${queryCount}`)
  })
})

// ─── S26.21: Read-only SQL test ───

describe('investigator read-only SQL (S26.21)', () => {
  test('all executed SQL is read-only (SELECT only)', async () => {
    const executedSqls: string[] = []
    const deps = makeDeps(async (query: string) => {
      executedSqls.push(query)
      // Return empty for schema scan
      return []
    })

    await investigate('مانده حساب', deps, undefined, { maxQueries: 50, timeoutMs: 5000, maxDepth: 2 })

    for (const sql of executedSqls) {
      const upper = sql.trim().toUpperCase()
      assert.ok(
        upper.startsWith('SELECT') || upper.startsWith('--') || upper.startsWith('WITH'),
        `SQL should be read-only (SELECT/--): ${sql.substring(0, 50)}`
      )
      assert.ok(!upper.includes('INSERT '), `SQL should not contain INSERT: ${sql.substring(0, 50)}`)
      assert.ok(!upper.includes('UPDATE '), `SQL should not contain UPDATE: ${sql.substring(0, 50)}`)
      assert.ok(!upper.includes('DELETE '), `SQL should not contain DELETE: ${sql.substring(0, 50)}`)
      assert.ok(!upper.includes('DROP '), `SQL should not contain DROP: ${sql.substring(0, 50)}`)
      assert.ok(!upper.includes('ALTER '), `SQL should not contain ALTER: ${sql.substring(0, 50)}`)
      assert.ok(!upper.includes('CREATE '), `SQL should not contain CREATE: ${sql.substring(0, 50)}`)
    }
  })
})

// ─── S26.19: Integration test for ambiguous party queries ───

describe('investigator integration (S26.19)', () => {
  test('returns refuse when schema scan returns no tables', async () => {
    const deps = makeDeps(async () => {
      // All queries return empty — no tables in database
      return []
    })

    const result = await investigate('گردش طرف حساب', deps, undefined, { maxQueries: 50, timeoutMs: 5000, maxDepth: 2 })
    assert.equal(result.kind, 'refuse')
    if (result.kind === 'refuse') {
      assert.ok(result.reason.includes('investigator'))
    }
  })

  test('DEFAULT_BUDGET has sensible values', () => {
    assert.ok(DEFAULT_BUDGET.maxQueries > 0)
    assert.ok(DEFAULT_BUDGET.maxQueries <= 200)
    assert.ok(DEFAULT_BUDGET.timeoutMs > 10_000)
    assert.ok(DEFAULT_BUDGET.timeoutMs <= 120_000)
    assert.ok(DEFAULT_BUDGET.maxDepth > 0)
    assert.ok(DEFAULT_BUDGET.maxDepth <= 10)
  })
})
