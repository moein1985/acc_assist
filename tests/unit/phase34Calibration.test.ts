import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import {
  loadChartOfAccountsMapping,
  defaultSepidarMapping,
  AccountConcept
} from '../../src/main/services/financialEngine/chartOfAccountsMapping'
import { compileMetricPlan, type CompilerDeps } from '../../src/main/services/financialEngine/compiler'
import type { ChartOfAccountsMapping } from '../../src/main/services/financialEngine/chartOfAccountsMapping'
import type { MetricDefinition, MetricPlan } from '../../src/main/services/financialEngine/types'

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
