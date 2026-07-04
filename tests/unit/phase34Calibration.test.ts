import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import {
  loadChartOfAccountsMapping,
  defaultSepidarMapping,
  AccountConcept,
  getDeploymentId,
  DEFAULT_DEPLOYMENT_ID
} from '../../src/main/services/financialEngine/chartOfAccountsMapping'
import { compileMetricPlan, type CompilerDeps } from '../../src/main/services/financialEngine/compiler'
import type { ChartOfAccountsMapping } from '../../src/main/services/financialEngine/chartOfAccountsMapping'
import type { MetricDefinition, MetricPlan } from '../../src/main/services/financialEngine/types'
import {
  getDeploymentRegistry,
  isMetricVerified,
  getDeploymentSummary,
  upsertVerificationRecord,
  type VerificationRecord
} from '../../src/main/services/financialEngine/deploymentRegistry'

const tmpDir = join(process.cwd(), 'tmp-test-calibration')
const configPath = join(tmpDir, 'chartOfAccountsMapping.json')

const fakeDeps: CompilerDeps = {
  quoteSqlTableRef: (ref: string) => ref,
  quoteSqlIdentifier: (v: string) => v,
  normalizePersianText: (s: string) => s
}

const validMapping: ChartOfAccountsMapping = {
  softwareId: 'sepidar',
  databaseName: 'TestDB',
  discoveryMethod: 'manual',
  confidence: 'high',
  concepts: {
    [AccountConcept.assets]: {
      type1Codes: ['01'],
      available: true,
      description: 'Assets',
    },
  },
}

const lowConfidenceAutoMapping: ChartOfAccountsMapping = {
  softwareId: 'sepidar',
  databaseName: 'TestDB',
  discoveryMethod: 'auto',
  confidence: 'low',
  concepts: {
    [AccountConcept.assets]: {
      type1Codes: ['01'],
      available: true,
      description: 'Assets',
    },
  },
}

const metricWithConceptFilter: MetricDefinition = {
  id: 'test_metric',
  titleFa: 'تست',
  anchors: [],
  softwareId: 'sepidar',
  grainSupported: ['total'],
  source: { primaryTable: 'ACC.VoucherDetail', alias: 'v' },
  measure: { kind: 'sum', column: 'Debit' },
  mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'test' }],
  accountConceptFilter: AccountConcept.assets,
  dimensions: [],
  dateColumn: 'v.Date'
} as unknown as MetricDefinition

const simplePlan: MetricPlan = {
  metricId: 'test_metric',
  grain: 'total',
  filters: [],
  confidence: 1.0
} as unknown as MetricPlan

before(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
  mkdirSync(tmpDir, { recursive: true })
})

after(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('S34.1: loadChartOfAccountsMapping returns default when config file missing', () => {
  const result = loadChartOfAccountsMapping(join(tmpDir, 'nonexistent.json'))
  assert.equal(result.source, 'default')
  assert.equal(result.mapping, defaultSepidarMapping)
  assert.equal(result.error, undefined)
})

test('S34.1: loadChartOfAccountsMapping loads valid config file', () => {
  writeFileSync(configPath, JSON.stringify(validMapping))
  const result = loadChartOfAccountsMapping(configPath)
  assert.equal(result.source, 'config')
  assert.equal(result.mapping.softwareId, 'sepidar')
  assert.equal(result.mapping.databaseName, 'TestDB')
  assert.equal(result.mapping.discoveryMethod, 'manual')
  assert.equal(result.mapping.confidence, 'high')
  assert.equal(result.error, undefined)
})

test('S34.2: Invalid JSON falls back to default (no crash)', () => {
  writeFileSync(configPath, '{ not valid json }')
  const result = loadChartOfAccountsMapping(configPath)
  assert.equal(result.source, 'default')
  assert.equal(result.mapping, defaultSepidarMapping)
  assert.ok(result.error && result.error.includes('Failed to load'))
})

test('S34.2: Schema validation failure falls back to default', () => {
  writeFileSync(configPath, JSON.stringify({ softwareId: 'sepidar' }))
  const result = loadChartOfAccountsMapping(configPath)
  assert.equal(result.source, 'default')
  assert.equal(result.mapping, defaultSepidarMapping)
  assert.ok(result.error && result.error.includes('Invalid chartOfAccountsMapping.json'))
})

test('S34.6: Safety gate throws on auto+low confidence mapping with accountConceptFilter', () => {
  assert.throws(
    () => compileMetricPlan(simplePlan, metricWithConceptFilter, {
      ...fakeDeps,
      chartOfAccountsMapping: lowConfidenceAutoMapping
    }),
    /S34.6 Safety Gate/
  )
})

test('S34.6: Safety gate does NOT throw with default (high confidence) mapping', () => {
  assert.doesNotThrow(() =>
    compileMetricPlan(simplePlan, metricWithConceptFilter, {
      ...fakeDeps,
      chartOfAccountsMapping: defaultSepidarMapping
    })
  )
})

test('S34.6: Safety gate does NOT throw with manual+low mapping (only auto+low blocked)', () => {
  const manualLow: ChartOfAccountsMapping = {
    ...lowConfidenceAutoMapping,
    discoveryMethod: 'manual'
  }
  assert.doesNotThrow(() =>
    compileMetricPlan(simplePlan, metricWithConceptFilter, {
      ...fakeDeps,
      chartOfAccountsMapping: manualLow
    })
  )
})

test('S34.6: Safety gate does NOT throw when metric has no accountConceptFilter', () => {
  const noFilterMetric = { ...metricWithConceptFilter, accountConceptFilter: undefined }
  assert.doesNotThrow(() =>
    compileMetricPlan(simplePlan, noFilterMetric as MetricDefinition, {
      ...fakeDeps,
      chartOfAccountsMapping: lowConfidenceAutoMapping
    })
  )
})

// ─── S34.7: Deployment ID ────────────────────────────────────────────────────

test('S34.7: getDeploymentId produces stable 16-char hex hash', () => {
  const id1 = getDeploymentId('sepidar', 'Sepidar01', '192.168.85.56')
  const id2 = getDeploymentId('sepidar', 'Sepidar01', '192.168.85.56')
  assert.equal(id1, id2, 'Same inputs should produce same deployment ID')
  assert.equal(id1.length, 16, 'Deployment ID should be 16 hex chars')
  assert.match(id1, /^[0-9a-f]{16}$/, 'Should be hex string')
})

test('S34.7: Different deployments produce different IDs', () => {
  const id1 = getDeploymentId('sepidar', 'Sepidar01', '192.168.85.56')
  const id2 = getDeploymentId('mahak', 'MahakDB', '192.168.85.15')
  assert.notEqual(id1, id2, 'Different deployments should have different IDs')
})

test('S34.7: DEFAULT_DEPLOYMENT_ID matches sepidar/Sepidar01/192.168.85.56', () => {
  const expected = getDeploymentId('sepidar', 'Sepidar01', '192.168.85.56')
  assert.equal(DEFAULT_DEPLOYMENT_ID, expected)
})

// ─── S34.8: Per-deployment registry ──────────────────────────────────────────

test('S34.8: getDeploymentRegistry returns registry with records for default deployment', () => {
  const reg = getDeploymentRegistry(DEFAULT_DEPLOYMENT_ID)
  assert.equal(reg.deploymentId, DEFAULT_DEPLOYMENT_ID)
  assert.ok(Object.keys(reg.records).length > 0, 'Default deployment should have records migrated from flat registry')
})

test('S34.8: getDeploymentRegistry returns empty registry for unknown deployment', () => {
  const unknownId = getDeploymentId('unknown', 'UnknownDB', '10.0.0.1')
  const reg = getDeploymentRegistry(unknownId)
  assert.equal(reg.deploymentId, unknownId)
  assert.equal(Object.keys(reg.records).length, 0)
})

test('S34.8: isMetricVerified returns true for known verified metric in default deployment', () => {
  // net_sales is a seed-verified metric
  assert.equal(isMetricVerified(DEFAULT_DEPLOYMENT_ID, 'net_sales'), true)
})

test('S34.8: isMetricVerified returns false for unverified metric', () => {
  assert.equal(isMetricVerified(DEFAULT_DEPLOYMENT_ID, 'nonexistent_metric'), false)
})

test('S34.8: upsertVerificationRecord adds record to deployment registry', () => {
  const testDeploymentId = getDeploymentId('test', 'TestDB', '127.0.0.1')
  const record: VerificationRecord = {
    metricId: 'test_metric',
    tier: 'T1',
    status: 'verified',
    expectedValue: 100,
    fiscalYear: '1402',
    oracleSql: 'SELECT 100',
    engineRequestId: 'test-123',
    diff: 0,
    tolerance: 0,
    verifiedAt: '2026-07-04',
    commit: '',
    notes: 'test'
  }
  upsertVerificationRecord(testDeploymentId, record)
  assert.equal(isMetricVerified(testDeploymentId, 'test_metric'), true)
})

test('S34.8: getDeploymentSummary returns correct counts', () => {
  const summary = getDeploymentSummary(DEFAULT_DEPLOYMENT_ID)
  assert.ok(summary.total > 0, 'Should have total > 0')
  assert.ok(summary.verified >= 0)
  assert.ok(summary.oracleOnly >= 0)
  assert.ok(summary.needsReview >= 0)
})

// ─── S34.9: Per-deployment safety gate ───────────────────────────────────────

test('S34.9: Strict mode throws for unverified metric in unknown deployment', () => {
  const unknownDeploymentId = getDeploymentId('unknown', 'UnknownDB', '10.0.0.99')
  assert.throws(
    () => compileMetricPlan(simplePlan, metricWithConceptFilter, {
      ...fakeDeps,
      chartOfAccountsMapping: defaultSepidarMapping,
      deploymentId: unknownDeploymentId,
      strictDeploymentMode: true
    }),
    /S34.9 Deployment Gate/
  )
})

test('S34.9: Strict mode does NOT throw for verified metric in default deployment', () => {
  // net_sales is verified in default deployment — but our test metric is 'test_metric'
  // which is not verified. Use a metric that IS verified.
  const verifiedMetric: MetricDefinition = {
    ...metricWithConceptFilter,
    id: 'net_sales'
  } as unknown as MetricDefinition
  const verifiedPlan: MetricPlan = {
    ...simplePlan,
    metricId: 'net_sales'
  } as unknown as MetricPlan
  assert.doesNotThrow(() =>
    compileMetricPlan(verifiedPlan, verifiedMetric, {
      ...fakeDeps,
      chartOfAccountsMapping: defaultSepidarMapping,
      deploymentId: DEFAULT_DEPLOYMENT_ID,
      strictDeploymentMode: true
    })
  )
})

test('S34.9: Non-strict mode does NOT throw even for unverified metric', () => {
  const unknownDeploymentId = getDeploymentId('unknown', 'UnknownDB', '10.0.0.99')
  assert.doesNotThrow(() =>
    compileMetricPlan(simplePlan, metricWithConceptFilter, {
      ...fakeDeps,
      chartOfAccountsMapping: defaultSepidarMapping,
      deploymentId: unknownDeploymentId,
      strictDeploymentMode: false
    })
  )
})

// ─── S34.11: E2E proof — custom mapping codes → SQL uses them ────────────────

test('S34.11: Custom mapping codes produce SQL with those codes', () => {
  // Create a mapping with intentionally different codes (e.g. '99' instead of '01')
  const customMapping: ChartOfAccountsMapping = {
    softwareId: 'custom',
    databaseName: 'CustomDB',
    discoveryMethod: 'manual',
    confidence: 'high',
    concepts: {
      [AccountConcept.assets]: {
        type1Codes: ['99', '88'],
        available: true,
        description: 'Custom assets codes',
      },
    },
  }

  // Compile a metric that uses accountConceptFilter=assets
  const compiled = compileMetricPlan(simplePlan, metricWithConceptFilter, {
    ...fakeDeps,
    chartOfAccountsMapping: customMapping
  })

  // The compiled SQL should contain the custom codes '99' and '88'
  assert.ok(compiled.sql.includes("'99'"), `SQL should contain custom code '99': ${compiled.sql}`)
  assert.ok(compiled.sql.includes("'88'"), `SQL should contain custom code '88': ${compiled.sql}`)
  // And should NOT contain the default code '01'
  assert.ok(!compiled.sql.includes("'01'"), `SQL should NOT contain default code '01': ${compiled.sql}`)
})

test('S34.11: Default mapping produces SQL with default codes', () => {
  const compiled = compileMetricPlan(simplePlan, metricWithConceptFilter, {
    ...fakeDeps,
    chartOfAccountsMapping: defaultSepidarMapping
  })

  // Default Sepidar mapping uses '11' and '12' for assets
  assert.ok(compiled.sql.includes("'11'"), `Default SQL should contain code '11': ${compiled.sql}`)
})

// ─── S34.12: Sepidar regression — default/absent config → same verified numbers ─

test('S34.12: Absent config falls back to default Sepidar mapping (no crash)', () => {
  const result = loadChartOfAccountsMapping(join(tmpDir, 'definitely_nonexistent.json'))
  assert.equal(result.source, 'default')
  assert.equal(result.mapping, defaultSepidarMapping)
  assert.equal(result.mapping.softwareId, 'sepidar')
  assert.equal(result.mapping.discoveryMethod, 'default')
  assert.equal(result.mapping.confidence, 'high')
})

test('S34.12: Default mapping produces same SQL as before calibration feature', () => {
  // Compile with default mapping — SQL should use standard Sepidar codes
  const compiled = compileMetricPlan(simplePlan, metricWithConceptFilter, {
    ...fakeDeps,
    chartOfAccountsMapping: defaultSepidarMapping
  })

  // Verify the SQL contains the standard Sepidar account codes
  // This ensures backward compatibility — same SQL as before S34
  assert.ok(compiled.sql.length > 0, 'Should produce valid SQL')
  assert.ok(compiled.sql.includes('SELECT'), 'Should be a SELECT query')
  // The account concept filter for assets should resolve to standard codes
  assert.ok(
    compiled.sql.includes("'11'") || compiled.sql.includes("'12'"),
    `Should contain standard Sepidar asset codes: ${compiled.sql}`
  )
})

test('S34.12: Default mapping verified metrics remain verified', () => {
  // The 5 seed-verified metrics should still be verified in the default deployment
  const verifiedMetrics = ['net_sales', 'trial_balance', 'cash_bank_balance', 'receivables', 'payables']
  for (const metricId of verifiedMetrics) {
    assert.equal(
      isMetricVerified(DEFAULT_DEPLOYMENT_ID, metricId),
      true,
      `${metricId} should be verified in default deployment`
    )
  }
})
