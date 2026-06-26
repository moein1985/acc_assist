/**
 * Metric catalog registry for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will populate this with declarative
 * MetricDefinition entries for each migrated metric.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { MetricDefinition, MetricId } from './types'

const catalog: MetricDefinition[] = [
  {
    id: 'net_sales',
    titleFa: 'فروش خالص',
    anchors: ['فروش', 'مبلغ فروش', 'درآمد فروش'],
    excludeSignals: ['خرید', 'هزینه', 'تعداد', 'چند'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_month'],
    source: { primaryTable: 'SLS.Invoice', alias: 'src' },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
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
      },
      {
        dimension: 'by_month',
        labelColumn: 'MONTH(src.Date)',
        labelType: 'int'
      }
    ],
    mandatoryFilters: []
  },
  {
    id: 'purchases',
    titleFa: 'خرید',
    anchors: ['خرید', 'مبلغ خرید', 'خرید کالا'],
    excludeSignals: ['فروش', 'درآمد'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'POM.PurchaseInvoice',
      alias: 'src',
      fallbackTables: [
        {
          table: 'INV.InventoryReceipt',
          alias: 'src',
          measure: { kind: 'sum', column: 'TotalPrice' },
          filters: [{ sql: 'src.IsReturn = 0', description: 'حذف مرجوعی' }]
        }
      ]
    },
    measure: { kind: 'sum', column: 'NetPriceInBaseCurrency' },
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
  },
  {
    id: 'account_balance',
    titleFa: 'مانده حساب',
    anchors: ['مانده حساب', 'مانده سرفصل', 'بدهکار بستانکار حساب'],
    excludeSignals: ['تراز', 'حساب‌ها', 'بانک', 'صندوق', 'کش', 'نقد'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        }
      ]
    },
    measure: { kind: 'debit_minus_credit', debitColumn: 'Debit', creditColumn: 'Credit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }],
    entityNameMatch: { column: 'a.Title', foldPersian: true }
  },
  {
    id: 'trial_balance',
    titleFa: 'تراز آزمایشی',
    anchors: ['تراز آزمایشی', 'بدهکار بستانکار حساب‌ها'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year', 'by_account'],
    source: {
      primaryTable: 'ACC.VoucherItem',
      alias: 'vi',
      requiredJoins: [
        {
          table: 'ACC.Voucher',
          alias: 'v',
          on: { sourceColumn: 'VoucherRef', targetColumn: 'VoucherId' }
        }
      ]
    },
    measure: { kind: 'sum', column: 'Debit' },
    dimensions: [
      {
        dimension: 'by_year',
        join: {
          table: 'FMK.FiscalYear',
          alias: 'fy',
          on: { sourceColumn: 'FiscalYearRef', targetColumn: 'FiscalYearId' },
          sourceAlias: 'v'
        },
        labelColumn: 'Title',
        labelType: 'nstring'
      },
      {
        dimension: 'by_account',
        join: {
          table: 'ACC.Account',
          alias: 'a',
          on: { sourceColumn: 'AccountSLRef', targetColumn: 'AccountId' }
        },
        labelColumn: 'a.Title',
        labelType: 'nstring'
      }
    ],
    mandatoryFilters: [{ sql: 'v.Type NOT IN (3, 4)', description: 'حذف اسناد اختتامیه/بستن' }]
  },
  {
    id: 'cash_bank_balance',
    titleFa: 'مانده نقد و بانک',
    anchors: ['مانده نقد', 'مانده بانک', 'مانده صندوق', 'مانده کش', 'مانده حساب بانکی'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: { primaryTable: 'RPA.CashBalance', alias: 'cb' },
    measure: { kind: 'sum', column: 'Balance' },
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
  },
  {
    id: 'sales_count',
    titleFa: 'تعداد فاکتور فروش',
    anchors: ['تعداد فاکتور فروش', 'تعداد فاکتور', 'چند فاکتور فروش'],
    excludeSignals: ['خرید', 'مانده', 'تراز', 'صندوق', 'بانک'],
    softwareId: 'sepidar',
    grainSupported: ['total', 'by_year'],
    source: {
      primaryTable: 'SLS.Invoice',
      alias: 'src'
    },
    measure: { kind: 'count' },
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
]

export function getMetricCatalog(): MetricDefinition[] {
  return catalog
}

export function findMetricById(id: MetricId): MetricDefinition | null {
  return catalog.find((m) => m.id === id) ?? null
}
