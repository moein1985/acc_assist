import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compileMetricPlan,
  type CompilerDeps
} from '../../src/main/services/financialEngine/compiler'
import {
  findMetricById,
  getMetricCatalog
} from '../../src/main/services/financialEngine/metricCatalog'
import { normalizePersianText } from '../../src/main/services/textNormalization'
import {
  quoteSqlIdentifier,
  quoteSqlTableRef
} from '../../src/main/services/agentOrchestrator/sqlUtils'
import type { MetricPlan, MetricDefinition } from '../../src/main/services/financialEngine/types'

const deps: CompilerDeps = {
  quoteSqlTableRef,
  quoteSqlIdentifier,
  normalizePersianText
}

test('METRIC_CATALOG contains net_sales', () => {
  const catalog = getMetricCatalog()
  const ids = catalog.map((m) => m.id)
  assert.ok(ids.includes('net_sales'), 'net_sales should be in catalog')
})

test('compileMetricPlan: net_sales total grain produces SUM query', () => {
  const def = findMetricById('net_sales')!
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(
    sql.includes('SUM(CAST(src.[NetPriceInBaseCurrency] AS decimal(18,4)))'),
    'should have SUM measure'
  )
  assert.ok(sql.includes('FROM [SLS].[Invoice] src'), 'should quote table ref as [SLS].[Invoice]')
  assert.ok(!sql.includes('[SLS.Invoice]'), 'should NOT have dot inside brackets')
})

test('compileMetricPlan: net_sales by_year filter adds JOIN FiscalYear and WHERE fy.Title', () => {
  const def = findMetricById('net_sales')!
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(sql.includes('JOIN [FMK].[FiscalYear] fy'), 'should JOIN FiscalYear')
  assert.ok(sql.includes("fy.Title = N'1402'"), "should filter fy.Title = N'1402'")
  assert.ok(!sql.includes('CAST(FiscalYearRef'), 'should NOT CAST FiscalYearRef')
})

test('compileMetricPlan: net_sales comparison by_year produces pivot with percent_change', () => {
  const def = findMetricById('net_sales')!
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'total',
    filters: [],
    comparison: {
      dimension: 'by_year',
      baseValue: '1402',
      targetValue: '1403'
    },
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(sql.includes('WITH yearly_data AS'), 'should have CTE')
  assert.ok(sql.includes('percent_change'), 'should have percent_change column')
  assert.ok(sql.includes("N'1402'"), "should reference base year N'1402'")
  assert.ok(sql.includes("N'1403'"), "should reference target year N'1403'")
  assert.ok(sql.includes('100.0'), 'should calculate percentage')
})

test('compileMetricPlan: net_sales by_year grain groups by fy.Title', () => {
  const def = findMetricById('net_sales')!
  const plan: MetricPlan = {
    metricId: 'net_sales',
    grain: 'by_year',
    filters: [],
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(sql.includes('fy.Title AS period'), 'should select fy.Title as period')
  assert.ok(sql.includes('GROUP BY fy.Title'), 'should GROUP BY fy.Title')
})

test('compileMetricPlan: SQL injection attempt in entityName is escaped', () => {
  const def: MetricDefinition = {
    id: 'account_balance',
    titleFa: 'مانده حساب',
    anchors: ['حساب'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: { primaryTable: 'ACC.Voucher', alias: 'v' },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [],
    entityNameMatch: { column: 'a.Title', foldPersian: true }
  }
  const plan: MetricPlan = {
    metricId: 'account_balance',
    grain: 'total',
    filters: [],
    entityName: "x' OR '1'='1",
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(sql.includes("x'' OR ''1''=''1"), 'single quotes should be escaped')
  assert.ok(!sql.includes("x' OR '1'='1"), 'raw injection should NOT be present')
})

test('METRIC_CATALOG contains all 5 metrics', () => {
  const catalog = getMetricCatalog()
  const ids = catalog.map((m) => m.id)
  assert.ok(ids.includes('purchases'), 'purchases should be in catalog')
  assert.ok(ids.includes('account_balance'), 'account_balance should be in catalog')
  assert.ok(ids.includes('trial_balance'), 'trial_balance should be in catalog')
  assert.ok(ids.includes('cash_bank_balance'), 'cash_bank_balance should be in catalog')
})

test('compileMetricPlan: account_balance produces debit_minus_credit with requiredJoins and mandatoryFilters', () => {
  const def = findMetricById('account_balance')!
  const plan: MetricPlan = {
    metricId: 'account_balance',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    entityName: 'دریافتنی',
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(
    sql.includes('SUM(vi.[Debit]) - SUM(vi.[Credit])'),
    'should have debit_minus_credit measure'
  )
  assert.ok(sql.includes('JOIN [ACC].[Voucher] v ON'), 'should have required join to ACC.Voucher')
  assert.ok(
    sql.includes('JOIN [FMK].[FiscalYear] fy ON v.[FiscalYearRef]'),
    'year join should use v.FiscalYearRef'
  )
  assert.ok(sql.includes('JOIN [ACC].[Account] a ON'), 'should join ACC.Account for entityName')
  assert.ok(
    sql.includes('v.Type NOT IN (3, 4)'),
    'should have mandatory filter v.Type NOT IN (3, 4)'
  )
  assert.ok(sql.includes('REPLACE'), 'should have Persian fold REPLACE for entityName')
  assert.ok(sql.includes('NCHAR(1610)'), 'should fold Yeh with NCHAR(1610)')
  assert.ok(sql.includes('NCHAR(1603)'), 'should fold Kaf with NCHAR(1603)')
  assert.ok(!sql.includes('[ACC.VoucherItem]'), 'should NOT have dot inside brackets')
  assert.ok(sql.includes('[ACC].[VoucherItem]'), 'should quote as [ACC].[VoucherItem]')
})

test('compileMetricPlan: trial_balance produces SUM(Debit) with requiredJoins and year filter', () => {
  const def = findMetricById('trial_balance')!
  const plan: MetricPlan = {
    metricId: 'trial_balance',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'eq', values: ['1402'] }],
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(
    sql.includes('SUM(CAST(vi.[Debit] AS decimal(18,4)))'),
    'should have SUM(Debit) measure'
  )
  assert.ok(sql.includes('JOIN [ACC].[Voucher] v ON'), 'should have required join to ACC.Voucher')
  assert.ok(sql.includes('JOIN [ACC].[Account] a ON'), 'should have required join to ACC.Account')
  assert.ok(sql.includes('v.Type NOT IN (3, 4)'), 'should have mandatory filter')
  assert.ok(sql.includes("fy.Title = N'1402'"), 'should filter by year')
})

test('compileMetricPlan: purchases produces SUM from INV.InventoryReceipt (S33.4 source fix)', () => {
  const def = findMetricById('purchases')!
  const plan: MetricPlan = {
    metricId: 'purchases',
    grain: 'total',
    filters: [],
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(
    sql.includes('SUM(CAST(src.[TotalPrice] AS decimal(18,4)))'),
    'should have SUM(TotalPrice)'
  )
  assert.ok(sql.includes('FROM [INV].[InventoryReceipt] src'), 'should use INV.InventoryReceipt (S33.4 fixed source)')
  assert.ok(sql.includes('src.IsReturn = 0'), 'should filter IsReturn=0')
})

test('compileMetricPlan: fiscal_year_count produces COUNT(*) from FMK.FiscalYear', () => {
  const def = findMetricById('fiscal_year_count')!
  const plan: MetricPlan = {
    metricId: 'fiscal_year_count',
    grain: 'total',
    filters: [],
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(sql.includes('COUNT(*)'), 'should have COUNT(*) measure')
  assert.ok(sql.includes('FROM [FMK].[FiscalYear] fy'), 'should use FMK.FiscalYear')
  assert.ok(!sql.includes('GROUP BY'), 'should NOT have GROUP BY for count')
})

test('compileMetricPlan: fiscal_year_list produces SELECT columns with ORDER BY and topN', () => {
  const def = findMetricById('fiscal_year_list')!
  const plan: MetricPlan = {
    metricId: 'fiscal_year_list',
    grain: 'total',
    filters: [],
    topN: 100,
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(sql.includes('TOP(100)'), 'should have TOP(100)')
  assert.ok(sql.includes('fy.[FiscalYearId]'), 'should select FiscalYearId')
  assert.ok(sql.includes('fy.[Title]'), 'should select Title')
  assert.ok(!sql.includes('AS result_value'), 'should NOT have result_value alias for list')
  assert.ok(!sql.includes('GROUP BY'), 'should NOT have GROUP BY for list')
  assert.ok(sql.includes('ORDER BY fy.Title DESC'), 'should have ORDER BY')
})

test('compileMetricPlan: between operator produces BETWEEN clause', () => {
  const def: MetricDefinition = {
    id: 'account_turnover',
    titleFa: 'گردش حساب',
    anchors: ['گردش'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: { primaryTable: 'ACC.Voucher', alias: 'v' },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' }
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: []
  }
  const plan: MetricPlan = {
    metricId: 'account_turnover',
    grain: 'total',
    filters: [{ dimension: 'by_year', op: 'between', values: ['1402', '1403'] }],
    confidence: 1.0
  }
  const { sql } = compileMetricPlan(plan, def, deps)

  assert.ok(sql.includes("BETWEEN N'1402' AND N'1403'"), 'should have BETWEEN clause')
})
